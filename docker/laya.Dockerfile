# Laya (https://github.com/NandhaKishorM/laya) ships no published image, but
# its `laya[serve]` pip extra is a documented, self-contained HTTP server
# (`laya-serve`, FastAPI + uvicorn) - see Docs/laya-integration-plan.md
# "Deployment" for why this project builds its own thin image around that
# extra rather than a repo checkout: it's the smaller, more reliable
# dependency surface (one pinned pip package vs. a full source build).
FROM python:3.11-slim

RUN pip install --no-cache-dir "laya[serve]"

# Model checkpoints are pulled from the Hugging Face Hub on first request and
# cached here - mount a volume at this path (see docker-compose.yml) so a
# container restart doesn't re-download them.
ENV HF_HOME=/root/.cache/huggingface
ENV LAYA_HOST=0.0.0.0
ENV LAYA_PORT=8000

EXPOSE 8000

CMD ["laya-serve"]
