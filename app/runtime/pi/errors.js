import { isContextOverflow } from '@earendil-works/pi-ai/utils/overflow';

/**
 * Return a useful explanation without logging arbitrary provider response text.
 * @param {{message?:any,status?:number,timeout?:number,attempt?:number,provider?:string,hostname?:string,cancelled?:boolean}} failure
 */
export function explainFailure(failure) {
  const { message, timeout, attempt = 1, provider = '', hostname = '', cancelled } = failure;
  const raw = String(message?.errorMessage ?? message?.message ?? message ?? '');
  const status =
    (failure.status >= 400 ? failure.status : null) ??
    (Number(raw.match(/\b(400|401|403|404|408|413|429|5\d\d)\b/)?.[1]) || null);
  if (cancelled) return { status, message: '已停止。', retryable: false };
  if (message?.role === 'assistant' && isContextOverflow(message))
    return { status, message: '内容超过了模型的上下文容量。', retryable: false };
  if (timeout)
    return {
      status,
      message: `模型 ${timeout / 1000} 秒没有返回新内容，已停止。`,
      retryable: true,
    };
  if (status === 401 || status === 403)
    return {
      status,
      message: `密钥无效或没有权限（HTTP ${status}）。请在设置里检查 ${provider} 的密钥。`,
      retryable: false,
    };
  if (status === 404)
    return { status, message: '找不到这个模型或接口地址（HTTP 404）。', retryable: false };
  if (status === 429)
    return { status, message: '请求太频繁或额度已用完（HTTP 429），稍后再试。', retryable: true };
  if (status >= 500)
    return {
      status,
      message: `服务暂时不可用（HTTP ${status}），已尝试 ${attempt} 次。`,
      retryable: true,
    };
  if (status)
    return {
      status,
      message: `模型请求未成功（HTTP ${status}）。请检查模型及接口设置。`,
      retryable: false,
    };
  if (
    /connect|network|fetch|ECONN|ENOTFOUND|EAI_AGAIN|socket|transport|timed? ?out|timeout/i.test(
      raw,
    )
  )
    return { status, message: `连不上 ${hostname}，请检查网络或代理。`, retryable: true };
  if (/api.?key|credential|auth|not configured/i.test(raw))
    return { status, message: `请在设置里填写 ${provider} 的密钥。`, retryable: false };
  return { status, message: '模型没有完成这次回答，请重试。', retryable: false };
}
