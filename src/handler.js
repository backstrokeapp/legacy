const Promise = require('bluebird');
const GitHubApi = require('github');

const log = (...args) => console.log.apply(console, ['*', ...args]);

// configure github api client
let github = new GitHubApi({});
if (process.env.GITHUB_TOKEN) {
  github.authenticate({
    type: "oauth",
    token: process.env.GITHUB_TOKEN,
  });
} else {
  console.warn("Warning: No github token specified.");
}

// import the libraries that are required for communication
const ghFactory = require('./github');
let gh = ghFactory.constructor(github);

// has the given fork diverged from its parent?
module.exports.hasDivergedFromUpstream = function hasDivergedFromUpstream(user, repo) {
  let repoContents;
  return gh.reposGet({user, repo}).then(repoData => {
    repoContents = repoData;
    if (repoData.parent) {
      return Promise.all([
        // base branch
        gh.reposGetBranch({
          user,
          repo,
          branch: repoData.default_branch,
        }),
        // upstream branch
        gh.reposGetBranch({
          user: repoData.parent.owner.login,
          repo: repoData.parent.name,
          branch: repoData.parent.default_branch,
        }),
      ]);
    } else {
      throw new Error(`The repository ${user}/${repo} isn't a fork.`);
    }
  }).then(([base, upstream]) => {
    return {
      repo: repoContents,
      diverged: base.commit.sha !== upstream.commit.sha,
      baseSha: base.commit.sha,
      upstreamSha: upstream.commit.sha,
    };
  });
}

module.exports.generateUpdateBody = function generateUpdateBody(fullRemote, tempRepoName) {
  return `Hello!
  The remote \`${fullRemote}\` has some new changes that aren't in this fork.

  So, here they are, ready to be merged! :tada:

  If this pull request can be merged without conflict, you can publish your software
  with these new changes.  Otherwise, if you have merge conflicts, this
  is the place to fix them.

  Have fun!
  --------
  Created by [Backstroke](http://backstroke.us). Oh yea, I'm a bot.
  `
}

// does a user want to opt out of receiving backstroke PRs?
module.exports.didUserOptOut = function didUserOptOut(user, repo) {
  return gh.searchIssues({
    q: `repo:${user}/${repo} is:pr label:optout`,
  }).then(issues => {
    return issues.total_count > 0;
  });
}

// Given a repository, open the pr to update it to its upstream.
module.exports.postUpdate = function postUpdate(repo, upstreamSha) {
  if (repo) {
    if (repo.parent) {
      return gh.pullRequestsGetAll({
        user: repo.owner.login || repo.owner.name,
        repo: repo.name,
        state: "open",
        head: `${repo.parent.owner.login}:${repo.parent.default_branch}`,
      }).then(existingPulls => {
        // are we trying to reintroduce a pull request that has already been
        // made previously?
        let duplicateRequests = existingPulls.find(pull => pull.head.sha === upstreamSha);
        if (!duplicateRequests) {
          log(`Making pull to ${repo.owner.login}/${repo.name}`);
          // create a pull request to merge in remote changes
          return gh.pullRequestsCreate({
            user: repo.owner.login, repo: repo.name,
            title: `Update from upstream repo ${repo.parent.full_name}`,
            head: `${repo.parent.owner.login}:${repo.parent.default_branch}`,
            base: repo.default_branch,
            body: module.exports.generateUpdateBody(repo.parent.full_name),
          });
        } else {
          log(`A Backstroke pull request already exists on ${repo.full_name}. Done.`);
          throw new Error(`A Backstroke pull request already exists on ${repo.full_name}`);
        }
      });
    } else {
      log(`${repo.full_name} is not a fork! Done.`);
      return Promise.reject(new Error(`The repository ${repo.full_name} isn't a fork.`));
    }
  } else {
    log(`repo was falsey, repo = ${repo}. Done.`);
    return Promise.reject(new Error(`No repository found`));
  }
}

// get the upstream user and repo name to check changes relative from
module.exports.getUpstream = function getUpstream(repository, opts={}) {
  let upstream = opts.upstream && opts.upstream.split("/");
  if (upstream && upstream.length === 2) {
    // a custom upstream
    return {user: upstream[0], repo: upstream[1]};
  } else if (repository && repository.fork && repository.parent) {
    // this is a fork, so the upstream is the parent repo
    return {
      user: repository.parent.owner.name || repository.parent.owner.login,
      repo: repository.parent.name,
    }
  } else {
    // this is the upstream, so just grab the current repo infirmation
    return {
      user: repository.owner.name || repository.owner.login,
      repo: repository.name,
    }
  }
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

module.exports.route = function route(req, res) {
  // Ensure the repository name is in the body.
  if (!(req.body.repository && req.body.repository.full_name)) {
    res.status(400).send({error: 'Malformed body, no .repository.full_name key.'});
  }
  if (!(req.body.repository && req.body.repository.default_branch)) {
    res.status(400).send({error: 'Malformed body, no .repository.default_branch key.'});
  }


  // the repo is a fork, or the user has manually specified an upstream to merge into
  if (
    (req.body && req.body.repository && req.body.repository.fork) ||
    req.query.upstream
  ) {
    const defaultBranch = req.body.repository.default_branch;
    console.log(`Hook received from upstream@${defaultBranch} --> ${req.body.repository.full_name}@${defaultBranch}`);

    // Try to merge upstream changes into the passed repo
    return module.exports.isForkMergeUpstream(req.body.repository, req.query).then(msg => {
      if (typeof msg === "string") {
        res.send({ok: true, detail: msg});
      } else {
        res.send({ok: true});
      }
    }).catch(error => {
      res.send({error: error.message});
    });
  } else {
    // Find all forks of the current repo and merge the passed repo's changes
    // into each
    const defaultBranch = req.body.repository.default_branch;
    console.log(`Hook received from ${req.body.repository.full_name}@${defaultBranch} --> all forks@${defaultBranch}`);

    return module.exports.isParentFindForks(req.body.repository, req.query).then(msg => {
      if (typeof msg === "string") {
        res.send({ok: true, detail: msg});
      } else {
        res.send({ok: true});
      }
    }).catch(error => {
      res.send({error: error.message});
    });
  }
}

// given a fork, create a pull request to merge in upstream changes
module.exports.isForkMergeUpstream = function isForkMergeUpstream(repository, opts={}) {
  // get the upstream to merge into
  const {user: upstreamName, repo: upstreamRepo} = module.exports.getUpstream(repository, opts);
  let repoName = repository.name, repoUser = repository.owner.name || repository.owner.login;

  // don't bug opted out users (opt out happens on the fork)
  return module.exports.didUserOptOut(repoUser, repoName).then(didOptOut => {
    if (didOptOut) {
      log(`Repo opted-out. Done.`);
      return {repo: null, diverged: false};
    } else {
      log('Repository did not opt-out.');
      // otherwise, keep going...
      return module.exports.hasDivergedFromUpstream(repoUser, repoName);
    }
  }).then(({repo, diverged, baseSha, upstreamSha}) => {
    if (diverged) {
      log(`Changes were found between the fork and upstream (${baseSha.slice(0, 8)} != ${upstreamSha.slice(0, 8)})`);
      // make a pull request
      return module.exports.postUpdate(repo, upstreamSha).then(ok => {
        log(`Pull request created for repo ${repo.full_name}.`);
        return true; // success
      });
    } else {
      log(`Fork and upstream haven't diverged. Done.`);
      return "Thanks anyway, but the user either opted out or this isn't an imporant event.";
    }
  });
}

module.exports.isParentFindForks = function isParentFindForks(repository, opts={}) {
  return gh.reposGetForks({
    user: repository.owner.name || repository.owner.login,
    repo: repository.name,
  }).then(forks => {
    let pullreqs = forks.map(fork => {
      return module.exports.isForkMergeUpstream(fork, opts);
    });

    return Promise.all(pullreqs).then(reqs => {
      let madePRs = reqs.filter(i => i); // all truthy pull requests
      return `Opened ${madePRs.length} pull requests on forks of this repository.`;
    });
  });
}
