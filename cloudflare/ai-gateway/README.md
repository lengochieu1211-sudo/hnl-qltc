# HNL QLTC AI Gateway

Isolated Cloudflare Worker for HNL Managed AI. This worker is separate from `cloudflare/r2-gateway` and must never share R2 write logic.

DEV worker: `hnl-qltc-ai-gateway-dev`.

Security model:
- `/health` is public and exposes no secret.
- `/v1/models` and `/v1/chat` require a valid Firebase ID token.
- Firebase token validity is checked server-side with the DEV Firebase Identity Toolkit endpoint.
- The gateway receives only provider-neutral prompts/evidence prepared by the HNL AI layer; it never reads Firestore business collections.
- Provider secrets, when used, are server-side Worker secrets only.
- Phase 3B starts with Cloudflare Workers AI binding; Gemini/OpenAI/Groq/OpenRouter adapters can be enabled later by adding Worker secrets without changing business calculation code.

The HNL deterministic Query/Calculation/Audit Engine remains authoritative. Provider output is narrative-only and is validated again in the client orchestrator.