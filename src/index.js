const express = require('express');
const app = express();

// parse body of incoming requests
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const handler = require('./handler');

app.post('/', handler.route);

const port = process.env.PORT || 8000;
app.listen(port);
console.log("Listening on port", port, "...");
