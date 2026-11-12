// kart all 이 실패한 편을 어떻게 다루는지. 브라우저를 띄우지 않는다.
//
// 맥북 덮개를 덮으면 잠들고, 다시 열면 올리던 편은 끊겨서 실패한다.
// 그때 전체가 멈추지 않고 그 편을 다시 시도해야 한다. 다만 저장 확인이 안 된
// 실패는 다시 시도하면 초안이 둘이 될 수 있으니 멈춰야 한다.
const { runWithRetry } = require('../src/retry');

const run = (codes) => {
  let calls = 0, waits = 0;
  const status = runWithRetry(() => { calls += 1; return codes[calls - 1]; }, { wait: () => { waits += 1; } });
  return { status, calls, waits };
};
const a = run([0]);
const b = run([1, 0]);          // 잠들었다 깬 경우: 한 번 끊기고 다음에 올라간다
const c = run([1, 1, 1]);
const d = run([2, 0]);          // 저장 확인 실패
const e = run([3, 0]);          // 로그인 필요
const checks = [
  ['바로 되면 한 번만 돌리나', a.status === 0 && a.calls === 1 && a.waits === 0],
  ['한 번 끊겨도 다시 시도해 올리나', b.status === 0 && b.calls === 2 && b.waits === 1],
  ['세 번 다 안 되면 멈추나', c.status === 1 && c.calls === 3],
  ['저장 확인이 안 된 실패는 다시 쓰지 않나 (초안 중복 방지)', d.status === 2 && d.calls === 1],
  ['로그인이 필요하면 다시 시도하지 않나', e.status === 3 && e.calls === 1],
];
let pass = true;
for (const [name, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${name}`); pass = pass && ok; }
process.exit(pass ? 0 : 1);
