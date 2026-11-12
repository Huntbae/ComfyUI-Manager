// 한 편을 올리되, 다시 해 볼 만한 실패면 몇 번 더 시도한다.
//
// 종료코드의 뜻 (index.js 의 next 가 정한다):
//   0 — 올라갔다
//   1 — 창이 닫힘·업로드가 끊김·에디터가 안 뜸 … 다시 해 볼 만하다
//   2 — 저장을 눌렀는데 확인이 안 됐다. 이미 저장됐을 수 있어, 다시 쓰면 초안이 둘이 된다
//   3 — 로그인이 필요하다. 사람이 해야 한다
// 2 와 3 은 다시 시도하지 않는다.
function runWithRetry(runOnce, { tries = 3, wait = () => {}, onRetry = () => {} } = {}) {
  let status = 1;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    status = runOnce(attempt);
    if (status === 0 || status === 2 || status === 3 || attempt === tries) break;
    onRetry(attempt + 1);
    wait();
  }
  return status;
}

module.exports = { runWithRetry };
