// 비밀값(쿠키)을 화면에 표시하지 않고 입력받는다.
// - 입력 문자는 에코하지 않으므로 터미널을 통째로 복사해도 값이 남지 않는다.
// - 붙여넣기 시 딸려오는 앞뒤 공백·개행은 제거한다.
const readline = require('readline');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      process.stdout.write(question);
      rl._writeToOutput = () => {}; // 입력 에코 억제
      rl.question('', (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer.replace(/\s+/g, '')); // 쿠키 값에는 공백이 없으므로 모두 제거
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

module.exports = { ask };
