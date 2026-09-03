import { createHash } from 'node:crypto';
import { config } from './config.js';

export async function exchangeWechatCode(code, overrides = {}) {
  const appid = overrides.appid || config.wechatAppid;
  const secret = overrides.secret || config.wechatSecret;

  if (!appid || !secret) {
    const digest = createHash('sha1').update(String(code)).digest('hex').slice(0, 24);
    return { openid: `dev_${digest}`, session_key: '', unionid: '', mock: true };
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', String(code));
  url.searchParams.set('grant_type', 'authorization_code');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`微信接口请求失败: HTTP ${res.status}`);
  const data = await res.json();
  if (data.errcode) {
    const messages = {
      40029: 'js_code 无效',
      45011: '调用频率超限',
      40226: '高风险用户'
    };
    throw new Error(`微信登录失败 (${data.errcode}): ${messages[data.errcode] || data.errmsg || '未知错误'}`);
  }
  return {
    openid: data.openid,
    session_key: data.session_key || '',
    unionid: data.unionid || ''
  };
}
