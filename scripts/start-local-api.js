const { startServer } = require('../apps/api/src/server.js');

startServer()
  .then(() => {
    setInterval(() => {}, 60_000);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
