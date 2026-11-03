/** npm run voice:list : liệt kê giọng từ server VieNeu để người dùng chọn. */
const endpoint = process.env.VIENEU_ENDPOINT ?? "http://127.0.0.1:8124";

fetch(`${endpoint}/voices`)
  .then((response) => response.json())
  .then((voices) => console.log(JSON.stringify(voices, null, 2)))
  .catch(() => {
    console.error(`VieNeu chưa chạy ở ${endpoint}. Chạy: npm run tts:server`);
    process.exit(1);
  });
