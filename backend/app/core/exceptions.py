"""
Wodoga Platform — Custom Exceptions
Structured error types that produce consistent API responses.
"""

from fastapi import HTTPException, status


class WodogaException(Exception):
    """Base exception for all Wodoga application errors."""
    def __init__(self, message: str, code: str = "error"):
        self.message = message
        self.code = code
        super().__init__(message)


class NotFoundError(WodogaException):
    """Resource does not exist or is not visible to this tenant."""
    def __init__(self, resource: str = "Resource"):
        super().__init__(f"{resource} not found.", code="not_found")


class PermissionDeniedError(WodogaException):
    """User lacks the required permission."""
    def __init__(self, action: str = "perform this action"):
        super().__init__(
            f"You do not have permission to {action}.",
            code="permission_denied",
        )


class AuthenticationError(WodogaException):
    """Authentication failed."""
    def __init__(self, message: str = "Authentication failed."):
        super().__init__(message, code="authentication_failed")


class AccountLockedError(WodogaException):
    """Account temporarily locked after failed login attempts."""
    def __init__(self, minutes: int = 30):
        super().__init__(
            f"Account temporarily locked. Try again in {minutes} minutes.",
            code="account_locked",
        )


class MFARequiredError(WodogaException):
    """MFA verification is required to complete login."""
    def __init__(self):
        super().__init__(
            "Multi-factor authentication is required.",
            code="mfa_required",
        )


class MFAInvalidError(WodogaException):
    """MFA code is incorrect or expired."""
    def __init__(self):
        super().__init__(
            "Invalid or expired verification code.",
            code="mfa_invalid",
        )


class ValidationError(WodogaException):
    """Input validation failed."""
    def __init__(self, message: str):
        super().__init__(message, code="validation_error")


class ConflictError(WodogaException):
    """Resource already exists or state conflict."""
    def __init__(self, message: str):
        super().__init__(message, code="conflict")


class StorageError(WodogaException):
    """File storage operation failed."""
    def __init__(self, message: str = "File storage operation failed."):
        super().__init__(message, code="storage_error")


class EligibilityAPIError(WodogaException):
    """External eligibility API call failed."""
    def __init__(self, message: str = "Eligibility verification service unavailable."):
        super().__init__(message, code="eligibility_api_error")


# ── HTTP Exception Converters ────────────────────────────────
def to_http_exception(exc: WodogaException) -> HTTPException:
    """Converts a WodogaException to an HTTPException with appropriate status."""
    status_map = {
        "not_found":            status.HTTP_404_NOT_FOUND,
        "permission_denied":    status.HTTP_403_FORBIDDEN,
        "authentication_failed": status.HTTP_401_UNAUTHORIZED,
        "account_locked":       status.HTTP_423_LOCKED,
        "mfa_required":         status.HTTP_202_ACCEPTED,
        "mfa_invalid":          status.HTTP_400_BAD_REQUEST,
        "validation_error":     status.HTTP_422_UNPROCESSABLE_ENTITY,
        "conflict":             status.HTTP_409_CONFLICT,
        "storage_error":        status.HTTP_503_SERVICE_UNAVAILABLE,
        "eligibility_api_error": status.HTTP_503_SERVICE_UNAVAILABLE,
    }
    return HTTPException(
        status_code=status_map.get(exc.code, status.HTTP_500_INTERNAL_SERVER_ERROR),
        detail={"error": exc.code, "message": exc.message},
    )
