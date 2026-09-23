import { useCallback, useEffect, useState } from 'react';
import {
  fetchConfig,
  resetConfig,
  updateConfig,
  type ConfigField,
  type ConfigFieldValue,
  type SkillRelationSeed,
} from './api';

function valueToText(type: ConfigField['type'], value: ConfigFieldValue): string {
  switch (type) {
    case 'string_list':
      return (value as string[]).join('\n');
    case 'regex':
      return value as string;
    case 'kv_map':
      return Object.entries(value as Record<string, string>)
        .map(([k, v]) => `${k} = ${v}`)
        .join('\n');
    case 'ordered_pattern_list':
      return (value as [string, string][]).map(([k, v]) => `${k}: ${v}`).join('\n');
    case 'relation_list':
      return (value as SkillRelationSeed[])
        .map((s) => `${s.a} | ${s.b} | ${s.type} | ${s.weight}`)
        .join('\n');
  }
}

function textToValue(type: ConfigField['type'], text: string): ConfigFieldValue {
  const lines = text.split('\n').map((line) => line.trim());
  const nonEmpty = lines.filter(Boolean);

  switch (type) {
    case 'string_list':
      return nonEmpty;
    case 'regex':
      return text.trim();
    case 'kv_map': {
      const map: Record<string, string> = {};
      for (const line of nonEmpty) {
        const i = line.indexOf('=');
        if (i === -1) throw new Error(`Line "${line}" is missing "=" (expected "key = value").`);
        map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      return map;
    }
    case 'ordered_pattern_list':
      return nonEmpty.map((line) => {
        const i = line.indexOf(':');
        if (i === -1) throw new Error(`Line "${line}" is missing ":" (expected "category: pattern").`);
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()] as [string, string];
      });
    case 'relation_list':
      return nonEmpty.map((line) => {
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length !== 4) {
          throw new Error(`Line "${line}" must have 4 parts separated by "|": a | b | type | weight.`);
        }
        const [a, b, type, weightText] = parts;
        if (type !== 'equivalent' && type !== 'related') {
          throw new Error(`Line "${line}": type must be "equivalent" or "related".`);
        }
        const weight = Number(weightText);
        if (!Number.isFinite(weight)) throw new Error(`Line "${line}": weight must be a number.`);
        return { a, b, type, weight };
      });
  }
}

function hint(type: ConfigField['type']): string | null {
  switch (type) {
    case 'string_list':
      return 'One entry per line.';
    case 'kv_map':
      return 'One "spelling = canonical" pair per line.';
    case 'ordered_pattern_list':
      return 'One "key: regex" row per line. Order matters - the first matching row wins, so keep specific rows first.';
    case 'relation_list':
      return 'One "skill a | skill b | equivalent or related | weight (0-1]" row per line.';
    default:
      return null;
  }
}

function ConfigBox({
  field,
  onSaved,
}: {
  field: ConfigField;
  onSaved: (field: ConfigField) => void;
}) {
  const [text, setText] = useState(valueToText(field.type, field.value));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(valueToText(field.type, field.value));
  }, [field.type, field.value]);

  const dirty = text !== valueToText(field.type, field.value);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const value = textToValue(field.type, text);
      const saved = await updateConfig(field.key, value);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setError(null);
    try {
      const saved = await resetConfig(field.key);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const rows =
    field.type === 'regex' ? 3 : field.type === 'kv_map' ? 4 : field.type === 'relation_list' ? 14 : 10;
  const fieldHint = hint(field.type);

  return (
    <div className="config-box">
      <div className="config-box-head">
        <div>
          <h2>
            {field.label}
            {!field.isDefault && <span className="config-badge">customized</span>}
          </h2>
          <p className="muted">{field.description}</p>
        </div>
        <div className="config-box-actions">
          <button
            className="btn-secondary"
            onClick={() => void handleReset()}
            disabled={resetting || saving || field.isDefault}
          >
            {resetting ? 'Resetting…' : 'Reset to default'}
          </button>
          <button
            className="btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || resetting || !dirty}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <textarea
        className="config-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={rows}
        aria-label={field.label}
      />
      {fieldHint && <p className="muted config-hint">{fieldHint}</p>}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function ConfigTab() {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFields(await fetchConfig());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaved = (saved: ConfigField) => {
    setFields((prev) => prev.map((f) => (f.key === saved.key ? saved : f)));
    setToast(`${saved.label} saved.`);
  };

  return (
    <section className="config-tab">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading configuration...</p>
      ) : (
        <div className="config-list">
          {fields.map((field) => (
            <ConfigBox key={field.key} field={field} onSaved={handleSaved} />
          ))}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
