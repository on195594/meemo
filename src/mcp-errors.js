'use strict';

var sdk = require('@modelcontextprotocol/server'),
    BaseOAuthError = sdk.OAuthError,
    OAuthErrorCode = sdk.OAuthErrorCode;

/**
 * Base OAuth 2.1 error extending the v2 SDK OAuthError while exposing
 * `.errorCode` alongside `.code` for internal middleware compatibility.
 */
class OAuthError extends BaseOAuthError {
    constructor(code, message, errorUri) {
        super(code, message, errorUri);
        this.name = this.constructor.name;
    }

    get errorCode() {
        return this.code;
    }
}

function defineOAuthError(name, code) {
    class SubOAuthError extends OAuthError {
        constructor(message, errorUri) {
            super(code, message, errorUri);
            this.name = name;
        }
    }
    SubOAuthError.errorCode = code;
    return SubOAuthError;
}

class CustomOAuthError extends OAuthError {
    constructor(customErrorCode, message, errorUri) {
        super(customErrorCode, message, errorUri);
    }
}

module.exports = {
    OAuthError: OAuthError,
    OAuthErrorCode: OAuthErrorCode,
    CustomOAuthError: CustomOAuthError,
    InvalidRequestError: defineOAuthError('InvalidRequestError', OAuthErrorCode.InvalidRequest),
    InvalidClientError: defineOAuthError('InvalidClientError', OAuthErrorCode.InvalidClient),
    InvalidGrantError: defineOAuthError('InvalidGrantError', OAuthErrorCode.InvalidGrant),
    UnauthorizedClientError: defineOAuthError('UnauthorizedClientError', OAuthErrorCode.UnauthorizedClient),
    UnsupportedGrantTypeError: defineOAuthError('UnsupportedGrantTypeError', OAuthErrorCode.UnsupportedGrantType),
    InvalidScopeError: defineOAuthError('InvalidScopeError', OAuthErrorCode.InvalidScope),
    AccessDeniedError: defineOAuthError('AccessDeniedError', OAuthErrorCode.AccessDenied),
    ServerError: defineOAuthError('ServerError', OAuthErrorCode.ServerError),
    TemporarilyUnavailableError: defineOAuthError('TemporarilyUnavailableError', OAuthErrorCode.TemporarilyUnavailable),
    UnsupportedResponseTypeError: defineOAuthError('UnsupportedResponseTypeError', OAuthErrorCode.UnsupportedResponseType),
    UnsupportedTokenTypeError: defineOAuthError('UnsupportedTokenTypeError', OAuthErrorCode.UnsupportedTokenType),
    InvalidTokenError: defineOAuthError('InvalidTokenError', OAuthErrorCode.InvalidToken),
    MethodNotAllowedError: defineOAuthError('MethodNotAllowedError', OAuthErrorCode.MethodNotAllowed),
    TooManyRequestsError: defineOAuthError('TooManyRequestsError', OAuthErrorCode.TooManyRequests),
    InvalidClientMetadataError: defineOAuthError('InvalidClientMetadataError', OAuthErrorCode.InvalidClientMetadata),
    InsufficientScopeError: defineOAuthError('InsufficientScopeError', OAuthErrorCode.InsufficientScope),
    InvalidTargetError: defineOAuthError('InvalidTargetError', OAuthErrorCode.InvalidTarget)
};
