// netlify/functions/test.js
exports.handler = async (event, context) => {
  console.log("TEST ESEGUITO CON SUCCESSO");
  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Hello from Netlify Function!" }),
  };
};