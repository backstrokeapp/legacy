const express = require('express');
const app = express();
const proxy = require('express-http-proxy');
 

// parse body of incoming requests
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const handler = require('./handler');

// Support backstroke classic.
app.post('/', handler.route);

// Support webhooks that were sent to the old backstroke.us, and transparently preoxy them to the
// new service.
app.post('/_:id', proxy('https://api.backstroke.co', {
  proxyReqPathResolver(req) {
    return `/_${req.params.id}`;
  },
  userResDecorator(res, resData, req) {
    const data = JSON.parse(resData.toString('utf8'));
    data.notice = `Backstroke's new location is https://backstroke.co, change this webhook to point to https://api.backstroke.co/_${req.params.id}.`;
    return JSON.stringify(data);
  },
}));

// Forward all other GET requests to the new service.
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.redirect(`https://backstroke.co${req.url}`); // req.url starts with a slash.
  } else {
    next();
  }
});

const port = process.env.PORT || 8000;
app.listen(port);
console.log("Listening on port", port, "...");
