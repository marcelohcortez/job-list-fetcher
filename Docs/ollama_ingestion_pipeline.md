# Local HR Ingestion Pipeline Specification (Ollama + Chroma)

This document provides technical instructions and copy-pasteable boilerplate for implementing a 100% local, high-accuracy job opening sanitization and vectorization pipeline. Pass this file directly to an AI engineer or assistant for immediate implementation.

---

## 1. System Architecture

The pipeline processes messy, unstructured job advertisements into optimized vector representations using local models via Ollama, structured parsing with Pydantic, and local storage in Chroma DB.

```
[Messy Job Ad Text]
       │
       ▼
[Step 1: Extraction] ──> Ollama (qwen2.5:7b) with Pydantic JSON Schema
       │
       ▼
[Step 2: Flattening] ──> Standardized Semantic Anchor String
       │
       ▼
[Step 3: Vectorization] ──> Ollama (nomic-embed-text)
       │
       ▼
[Step 4: Storage] ──> Chroma DB (Payload + Vectors + Metadata ID)
```

---

## 2. Model Recommendations

Run the following commands in your terminal to download the recommended local models:

```bash
# High-accuracy structured text extractor with superior JSON constraint handling
ollama run qwen2.5:7b

# Highly efficient local embedding model with 8192 token context window
ollama run nomic-embed-text
```

---

## 3. Recommended Embedding Strategy

**Strategy: The Clean Semantic Anchor String**
To achieve optimal similarity matching scores against CVs, do not embed raw JSON strings. JSON characters (`{`, `}`, `"`) degrade vector semantic distances.

Instead, reconstruct the extracted JSON back into a highly organized, standardized paragraph text blocks containing contextual headers. This strategy matches perfectly when you parse and embed CVs under similar categorical headers later.

**Anchor String Template Blueprint:**

```text
JOB TITLE: [job_title]
TECHNICAL SKILLS: [skill1, skill2, skill3]
EXPERIENCE PROFILE: [experience_required]
CORE RESPONSIBILITIES: [responsibility1. responsibility2]
```

---

## 4. Implementation Code Blueprint

Ensure dependencies are installed:

```bash
pip install ollama pydantic chromadb
```

### complete_pipeline.py

```python
import json
import chromadb
from pydantic import BaseModel, Field
from typing import List
import ollama

# ==========================================
# 1. DEFINE STRUCTURED DATA SCHEMA
# ==========================================
class SanitizedJobOpening(BaseModel):
    job_title: str = Field(description="The formal title of the job position.")
    required_skills: List[str] = Field(description="Hard technical skills, programming languages, databases, or frameworks.")
    soft_skills: List[str] = Field(description="Soft skills, team dynamics traits, or working style requirements.")
    experience_required: str = Field(description="Years of experience, seniority requirements, or degree benchmarks.")
    core_responsibilities: List[str] = Field(description="Core tasks the employee must execute. Omit general corporate overhead descriptions.")

# ==========================================
# 2. INITIALIZE VECTOR DATABASE (CHROMA)
# ==========================================
# Persistent local storage client
chroma_client = chromadb.PersistentClient(path="./chroma_db")

# Create or get collection
# Chroma handles embeddings automatically if using a native collection function,
# but we will manually pass Ollama's embeddings to keep total control.
collection = chroma_client.get_or_create_collection(name="sanitized_job_openings")

# ==========================================
# 3. EXTRACTION AND INGESTION PIPELINE
# ==========================================
def process_and_store_job(job_id: str, raw_text: str):
    print(f"[*] Processing job assignment reference: {job_id}...")

    # --- STEP A: LLM Fluff Sanitization & Schema Enforcement ---
    try:
        response = ollama.chat(
            model='qwen2.5:7b',
            messages=[
                {
                    'role': 'system',
                    'content': (
                        "You are an elite automated recruiter parser. Your job is to extract exact requirements "
                        "and criteria fields into the requested JSON schema. Completely ignore company profiles, "
                        "marketing fluff, company background history, cultural benefits like snacks or equity, "
                        "and generic text."
                    )
                },
                {
                    'role': 'user',
                    'content': f"Extract the target schema from this job advertisement:

{raw_text}"
                }
            ],
            format=SanitizedJobOpening.model_json_schema(),
            options={'temperature': 0.0} # Low temperature to prevent hallucinations
        )

        # Load structured results
        structured_json = json.loads(response['message']['content'])

    except Exception as e:
        print(f"[!] Error running Ollama schema extraction: {e}")
        return False

    # --- STEP B: Generate Clean Semantic Anchor String ---
    skills_str = ", ".join(structured_json.get("required_skills", []))
    responsibilities_str = " ".join(structured_json.get("core_responsibilities", []))

    anchor_document = (
        f"JOB TITLE: {structured_json.get('job_title')}
"
        f"TECHNICAL SKILLS: {skills_str}
"
        f"EXPERIENCE PROFILE: {structured_json.get('experience_required')}
"
        f"CORE RESPONSIBILITIES: {responsibilities_str}"
    )

    # --- STEP C: Generate Local Vectors via Embedding Model ---
    try:
        embed_response = ollama.embeddings(
            model='nomic-embed-text',
            prompt=anchor_document
        )
        vector_embedding = embed_response['embedding']
    except Exception as e:
        print(f"[!] Error creating embeddings with nomic-embed-text: {e}")
        return False

    # --- STEP D: Upsert into Chroma DB ---
    # Prepare metadata for filtering capabilities during later CV matching loops
    metadata = {
        "job_title": structured_json.get("job_title", "Unknown"),
        "experience_required": structured_json.get("experience_required", "Unknown")
    }

    collection.upsert(
        ids=[job_id],
        embeddings=[vector_embedding],
        documents=[anchor_document], # Chroma keeps text searchable alongside vectors
        metadatas=[metadata]
    )
    print(f"[+] Successfully structured, vectorized, and stored Job Reference: {job_id}
")
    return True

# ==========================================
# TEST EXECUTION PIPELINE
# ==========================================
if __name__ == "__main__":
    messy_sample_input = """
    Welcome to NexusTech Solutions! We were voted best startup in 2025. We believe in high velocity, synergy,
    and changing the digital sphere. We provide top tier health plans, an open kitchen with cold brew on tap,
    and weekly gaming tournaments.

    We are urgently looking for a Senior DevOps Engineer to optimize our infrastructure!

    Required Experience:
    - At least 4-6 years in an active AWS DevOps or SRE role.
    - Strong skills deploying container infrastructure via Docker and Kubernetes (EKS).
    - Automation experience using Terraform scripting.
    - Solid understanding of Linux systems security.

    You'll be working in our office located downtown, maintaining uptime, and configuring build pipelines.
    Come grow with us!
    """

    # Run the integration sample
    process_and_store_job(job_id="job_id_101", raw_text=messy_sample_input)
```

---

## 5. Implementation Roadmap for the Assistant AI

When implementing the full scope of this software architecture, verify that you handle the following criteria:

1. **Batching Protocols:** Implement automated queuing limits or loop delays when dealing with folders of thousands of raw text files to avoid overloading the local hardware memory context window.
2. **Symmetrical Pipeline Requirement:** When matching resumes (CVs) later against this database collection, **you must route the CV through the exact same processing rules**. Use `qwen2.5:7b` to extract parsed candidate skills, construct a matching structural anchor paragraph schema, vectorise it with `nomic-embed-text`, and execute a query across this Chroma DB store using `collection.query()`.
3. **Strict Validation Error Catching:** Occasionally, local models might encounter heavily mangled postings causing bad JSON payload rendering. Ensure strict `try-except` try-blocks are active to safely segregate failed parse attempts into an isolate log for clean processing continuity.
