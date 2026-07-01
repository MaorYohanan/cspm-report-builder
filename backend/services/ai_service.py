"""
Gemini AI service for text improvement and summarization.

This service provides AI-powered capabilities for:
- Improving text phrasing (e.g., security findings, descriptions)
- Generating remediation summaries from detailed instructions
- Automatic model fallback on rate limiting (429 errors)
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Optional

_log = logging.getLogger(__name__)


class GeminiService:
    """
    Service for interacting with Google's Gemini AI API.

    Supports multiple models with automatic fallback on rate limiting.
    """

    # Default system prompts
    EXEC_SUMMARY_SYSTEM_PROMPT = (
        "You are a senior cloud security consultant writing a CSPM assessment report. "
        "Given a list of cloud security findings, write a professional executive summary "
        "consisting of exactly 3 paragraphs:\n"
        "1. Overall cloud security posture — tone should reflect the severity distribution.\n"
        "2. Key risk areas and root causes identified across the findings.\n"
        "3. Recommended immediate priorities and remediation direction.\n\n"
        "Rules:\n"
        "- Write in formal, professional Hebrew.\n"
        "- Keep technical terms in English (IAM, S3, VPC, MFA, RBAC, GCP, AWS, Azure, "
        "Kubernetes, Cloud Run, etc.).\n"
        "- Do NOT use bullet points — write flowing paragraphs only.\n"
        "- Focus on patterns, root causes, and business impact — not individual finding details.\n"
        "- Return ONLY the 3 paragraphs. No headers, no markdown, no extra text."
    )

    DEFAULT_IMPROVE_SYSTEM_PROMPT = (
        "You are a senior cloud security consultant writing a CSPM assessment report. "
        "Your task is to improve the phrasing of the given text. "
        "Rules:\n"
        "- Write in professional Hebrew. Use common English technical terms as-is "
        "(e.g. IAM, S3 Bucket, RBAC, VPC, MFA, encryption at rest) — do not translate them.\n"
        "- Be concise and precise. Avoid filler words.\n"
        "- Use formal but readable tone suitable for a security report delivered to management.\n"
        "- Preserve the original meaning and all technical details.\n"
        "- Return ONLY the improved text, nothing else. No explanations, no markdown.\n"
        "- The input may start with a [שדה: ...] tag indicating the field context. "
        "Use it to understand the context but NEVER include it in your output."
    )

    DEFAULT_SUMMARIZE_SYSTEM_PROMPT = (
        "You are a senior cloud security consultant. "
        "Given a cloud security finding and its remediation instructions, explain in 2-3 short sentences "
        "the LOGIC and REASONING behind the remediation steps — WHY these steps fix the problem, "
        "what security risk they mitigate, and what could happen if left unaddressed. "
        "Be clear, concise, and easy to understand. Avoid jargon where possible. "
        "Do NOT repeat the remediation steps themselves. Do NOT include CLI commands or code. "
        "Write in Hebrew. Technical terms like IAM, S3, VPC, MFA, RBAC, WAF, GCP, AWS, Azure, firewall should stay in English."
    )

    def __init__(
        self,
        api_key: str,
        models: Optional[list[str]] = None,
        default_model: Optional[str] = None,
        timeout: int = 30,
        max_retries: int = 3
    ):
        """
        Initialize the Gemini AI service.

        Args:
            api_key: Google AI API key for Gemini
            models: List of model names to try (in order). Defaults to standard Gemini models.
            default_model: Default model to use first. If None, uses first model in list.
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts per model

        Raises:
            ValueError: If api_key is empty
        """
        if not api_key:
            raise ValueError("API key is required")

        self.api_key = api_key
        self.models = models or [
            "gemini-2.0-flash",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
        ]
        self.default_model = default_model or self.models[0]
        self.timeout = timeout
        self.max_retries = max_retries

        if self.default_model not in self.models:
            raise ValueError(f"Default model {self.default_model} not in models list")

    def improve_text(
        self,
        text: str,
        field_context: Optional[str] = None,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.4,
        max_tokens: int = 2048
    ) -> tuple[str, str]:
        """
        Improve the phrasing of given text using AI.

        Args:
            text: Text to improve
            field_context: Optional context hint (e.g., "title", "description")
            model: Specific model to use. If None, uses default_model.
            system_prompt: Custom system prompt. If None, uses default.
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum output tokens

        Returns:
            Tuple of (improved_text, model_used)

        Raises:
            ValueError: If text is empty or too long
            RuntimeError: If all models fail or content is blocked
        """
        if not text or not text.strip():
            raise ValueError("Text cannot be empty")

        if len(text) > 5000:
            raise ValueError("Text too long (max 5000 chars)")

        # Build user prompt with optional field context
        user_prompt = text
        if field_context:
            user_prompt = f"[שדה: {field_context}]\n{text}"

        system_prompt = system_prompt or self.DEFAULT_IMPROVE_SYSTEM_PROMPT

        # Call Gemini with single model (no fallback for improve_text by default)
        result_text, used_model = self._call_gemini(
            prompt=user_prompt,
            system_prompt=system_prompt,
            model=model or self.default_model,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_fallback=False  # Don't fallback for simple improvements
        )

        # Strip field hint tag if the model echoed it back
        if result_text.startswith("[שדה:"):
            idx = result_text.find("]")
            if idx != -1:
                result_text = result_text[idx + 1:].strip()

        return result_text, used_model

    def summarize_remediation(
        self,
        title: str,
        description: str = "",
        remediation: str = "",
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 4096
    ) -> tuple[str, str]:
        """
        Generate a summary explaining the logic behind remediation steps.

        Args:
            title: Finding title
            description: Finding description
            remediation: Detailed remediation instructions
            model: Preferred model to try first. Falls back to other models on 429.
            system_prompt: Custom system prompt. If None, uses default.
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum output tokens

        Returns:
            Tuple of (summary, model_used)

        Raises:
            ValueError: If all inputs are empty or too long
            RuntimeError: If all models fail or content is blocked
        """
        if not title and not remediation:
            raise ValueError("At least title or remediation must be provided")

        # Truncate long remediation text
        if len(remediation) > 5000:
            remediation = remediation[:5000]

        # Build structured prompt
        prompt_parts = []
        if title:
            prompt_parts.append(f"Finding: {title}")
        if description:
            prompt_parts.append(f"Description: {description}")
        if remediation:
            prompt_parts.append(f"Remediation instructions:\n{remediation}")

        user_prompt = "\n\n".join(prompt_parts)
        system_prompt = system_prompt or self.DEFAULT_SUMMARIZE_SYSTEM_PROMPT

        # Call Gemini with fallback enabled for summaries
        return self._call_gemini(
            prompt=user_prompt,
            system_prompt=system_prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_fallback=True  # Enable model fallback for critical summaries
        )

    def generate_exec_summary(
        self,
        findings: list[dict],
        client: str = "",
        model: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 4096
    ) -> tuple[str, str]:
        """
        Generate a 3-paragraph Hebrew executive summary from a findings list.

        Args:
            findings: List of finding dicts with title, severity, category, exception fields
            client: Client/product name for context
            model: Preferred model. Falls back on 429.
            temperature: Sampling temperature
            max_tokens: Maximum output tokens

        Returns:
            Tuple of (summary_text, model_used)

        Raises:
            ValueError: If findings list is empty
            RuntimeError: If all models fail or content is blocked
        """
        if not findings:
            raise ValueError("Findings list cannot be empty")

        severity_counts: dict[str, int] = {}
        lines = []
        for f in findings:
            sev = f.get("severity", "unknown")
            severity_counts[sev] = severity_counts.get(sev, 0) + 1
            excepted = bool((f.get("exception") or {}).get("active", False))
            cat = f.get("category", "")
            title = (f.get("title") or "")[:200]
            line = f"- [{sev.upper()}] [{cat}] {title}"
            if excepted:
                line += " (מוחרג)"
            lines.append(line)

        summary_line = ", ".join(f"{k}: {v}" for k, v in severity_counts.items())
        prompt = f"לקוח: {client}\n" if client else ""
        prompt += f"סיכום חומרות: {summary_line}\n\nרשימת ממצאים:\n" + "\n".join(lines)

        return self._call_gemini(
            prompt=prompt,
            system_prompt=self.EXEC_SUMMARY_SYSTEM_PROMPT,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_fallback=True
        )

    def _call_gemini(
        self,
        prompt: str,
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.4,
        max_tokens: int = 2048,
        enable_fallback: bool = False
    ) -> tuple[str, str]:
        """
        Internal method to call Gemini API with retry logic.

        Args:
            prompt: User prompt
            system_prompt: System instruction
            model: Model to use. If None, uses default_model.
            temperature: Sampling temperature
            max_tokens: Maximum output tokens
            enable_fallback: If True, try other models on 429 rate limit errors

        Returns:
            Tuple of (response_text, model_used)

        Raises:
            RuntimeError: If all attempts fail or content is blocked
        """
        # Determine models to try
        target_model = model or self.default_model

        if enable_fallback:
            # Try requested model first, then fall back to others.
            if target_model in self.models:
                models_to_try = [target_model]
                for m in self.models:
                    if m not in models_to_try:
                        models_to_try.append(m)
            else:
                # Requested model isn't in the whitelist (stale client, typo, etc.)
                # — fall back to the full whitelist instead of silently skipping
                # straight to whatever happens to be first in self.models without
                # any log trail.
                _log.warning(
                    "Requested model %r not in whitelist %s; using full fallback list",
                    target_model, self.models,
                )
                models_to_try = list(self.models)
        else:
            # Only try the requested model
            models_to_try = [target_model]

        # Payload structure
        payload_dict = {
            "contents": [{"parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens
            }
        }

        last_error: Optional[tuple[int, str]] = None

        for i, try_model in enumerate(models_to_try):
            if i > 0:
                _log.info("Gemini model fallback: %s → %s", models_to_try[i-1], try_model)

            # Retry logic for transient errors (network, timeout)
            for attempt in range(self.max_retries):
                try:
                    response_text = self._single_api_call(try_model, payload_dict)

                    if response_text:
                        if i > 0:
                            _log.info("Gemini success with fallback model: %s", try_model)
                        return response_text, try_model
                    else:
                        _log.info("Gemini %s: empty response, trying next model", try_model)
                        break  # Don't retry on empty response, go to next model

                except urllib.error.HTTPError as e:
                    error_body = e.read().decode("utf-8", errors="replace")
                    last_error = (e.code, error_body)

                    if e.code == 429:
                        # Rate limit - try next model immediately
                        _log.warning("Gemini %s: rate limited (429), trying next model", try_model)
                        break
                    elif e.code == 400:
                        # Bad request - check if content was blocked.
                        # Parse separately so a malformed (non-JSON) error body
                        # falls through to the generic 400 handler instead of
                        # leaking a JSONDecodeError to the caller.
                        try:
                            error_data = json.loads(error_body)
                        except json.JSONDecodeError:
                            error_data = None
                        if isinstance(error_data, dict):
                            block_reason = error_data.get("error", {}).get("message", "")
                            if "blocked" in block_reason.lower():
                                raise RuntimeError(f"Content blocked: {block_reason}")
                        # Other 400 errors - don't retry
                        raise RuntimeError(f"API error {e.code}: {error_body}")
                    elif e.code >= 500:
                        # Server error - retry same model
                        if attempt < self.max_retries - 1:
                            wait_time = (2 ** attempt) * 0.5  # Exponential backoff
                            time.sleep(wait_time)
                            continue
                        else:
                            break  # Move to next model after max retries
                    else:
                        # Other HTTP errors - don't retry
                        raise RuntimeError(f"API error {e.code}: {error_body}")

                except (urllib.error.URLError, TimeoutError) as e:
                    # Network/timeout error - retry same model
                    last_error = (0, str(e))
                    if attempt < self.max_retries - 1:
                        wait_time = (2 ** attempt) * 0.5
                        time.sleep(wait_time)
                        continue
                    else:
                        break  # Move to next model after max retries

                except Exception as e:
                    # Unexpected error
                    last_error = (0, str(e))
                    break

        # All models exhausted
        if last_error:
            code, details = last_error
            if code == 429:
                raise RuntimeError(f"All models rate limited. Last error: {details}")
            else:
                raise RuntimeError(f"All models failed (last error code: {code}): {details}")

        raise RuntimeError("No response from any model")

    def _single_api_call(self, model: str, payload_dict: dict) -> str:
        """
        Make a single API call to Gemini.

        Args:
            model: Model name
            payload_dict: Request payload dictionary

        Returns:
            Response text from the model

        Raises:
            urllib.error.HTTPError: On HTTP errors
            urllib.error.URLError: On network errors
            RuntimeError: If response format is invalid or content is blocked
        """
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )

        payload = json.dumps(payload_dict).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        # Parse response
        candidates = result.get("candidates", [])

        if not candidates:
            # Check if content was blocked
            block_reason = result.get("promptFeedback", {}).get("blockReason", "")
            if block_reason:
                raise RuntimeError(f"Content blocked: {block_reason}")
            return ""

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            return ""

        return parts[0].get("text", "").strip()
