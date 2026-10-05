/**
 * Application error with a stable code and a user-facing message.
 * Routes turn it into an HTTP response; nothing else formats errors for users.
 */
export class AppError extends Error {
  /**
   * @param {string} code Stable English identifier, e.g. 'MEETING_NOT_FOUND'.
   * @param {string} message User-facing text.
   * @param {number} [status] HTTP status used by the server layer.
   */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}
