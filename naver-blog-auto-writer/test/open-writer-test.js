// 글쓰기 화면 진입 시험. 네이버에 접속하지 않고, 요청을 가로채 같은 상황을 만든다.
//
// 실제로 난 일: 네이버가 세션을 갱신하면서 글쓰기 주소를 로그인 페이지로 보냈다가
// 블로그 홈으로 돌려보냈다 (postwrite → nidlogin → finalize → 블로그 홈).
// 로그인은 살아 있었는데 그 한 번의 튕김을 실패로 처리해 아무것도 못 올렸다.
// 다시 가면 열린다는 것, 그리고 정말 로그인 폼에 막혔을 때는 need_login 으로
// 돌려준다는 것을 고정한다.
const fs = require('fs');
const R = require('path').join(__dirname, '..');
const { chromium } = require('playwright-core');
const { findChromium } = require(R + '/src/chromium-path');
const { openWriter } = require(R + '/src/post.js');
const editorHtml = fs.readFileSync(R + '/test/fake-editor.html', 'utf8');
(async () => {
  const b = await chromium.launch({ executablePath: findChromium(), headless: true });
  const results = [];
  const scenario = async (name, { bounces, stuckAtLogin = false }) => {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    let hits = 0;
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.includes('/postwrite')) {
        hits += 1;
        if (stuckAtLogin) return route.fulfill({ contentType: 'text/html', body: '<script>location.href="https://nid.naver.com/nidlogin.login"</script>' });
        if (hits <= bounces) return route.fulfill({ contentType: 'text/html', body: '<script>location.href="https://nid.naver.com/nidlogin.login?mode=form"</script>' });
        return route.fulfill({ contentType: 'text/html', body: editorHtml });
      }
      if (u.includes('nidlogin')) {
        // 자동 갱신: 로그인 페이지가 스스로 블로그 홈으로 보낸다. 막힌 경우는 폼에 머문다.
        return route.fulfill({ contentType: 'text/html', body: stuckAtLogin
          ? '<form>아이디 <input name=id></form>'
          : '<script>setTimeout(()=>location.href="https://blog.naver.com/huntbae?Redirect=&categoryNo=",300)</script>' });
      }
      return route.fulfill({ contentType: 'text/html', body: '<frameset><frame name="mainFrame" src="about:blank"></frameset>' });
    });
    const t0 = Date.now();
    const r = await openWriter(page, 'huntbae');
    const line = `${name}: root=${r.root ? '있음' : '없음'} where=${r.where} 시도=${r.attempts} (${Math.round((Date.now() - t0) / 1000)}초, 글쓰기 주소 ${hits}번 방문)`;
    console.log(line);
    await ctx.close();
    return r;
  };
  const a = await scenario('바로 열림          ', { bounces: 0 });
  const c = await scenario('한 번 튕김 (실제 사례)', { bounces: 1 });
  const d = await scenario('두 번 튕김          ', { bounces: 2 });
  const e = await scenario('로그인 폼에 머묾     ', { bounces: 0, stuckAtLogin: true });
  await b.close();
  const ok = a.root && a.attempts === 1 && c.root && c.attempts === 2 && d.root && d.attempts === 3 && !e.root && e.where === 'need_login';
  console.log(ok ? '\n모두 기대대로' : '\n기대와 다름');
  process.exit(ok ? 0 : 1);
})();
