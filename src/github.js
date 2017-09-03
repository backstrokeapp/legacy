const Promise = require('bluebird');

module.exports.constructor = function constructor(github) {
  return {
    reposGet: Promise.promisify(github.repos.get),
    reposGetBranch: Promise.promisify(github.repos.getBranch),
    reposGetForks: Promise.promisify(github.repos.getForks),
    pullRequestsCreate: Promise.promisify(github.pullRequests.create),
    pullRequestsGetAll: Promise.promisify(github.pullRequests.getAll),

    reposCreateHook: Promise.promisify(github.repos.createHook),
    reposFork: Promise.promisify(github.repos.fork),
    reposGetCollaborators: Promise.promisify(github.repos.getCollaborators),
    searchIssues: Promise.promisify(github.search.issues),
  };
}
