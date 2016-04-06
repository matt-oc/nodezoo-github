'use strict'

var GitHub = require('github4')
var github = new GitHub()
var Request = require('request')
var _ = require('lodash')
var gitUrl

var opts = {
  registry: 'http://registry.npmjs.org/',
  token: ''
}

module.exports = function (options) {
  var seneca = this
  var extend = seneca.util.deepextend

  opts = extend(opts, options)

  seneca.add('role:github,cmd:get', cmd_get)
  seneca.add('role:github,cmd:query', cmd_query)
  seneca.add('role:github,cmd:parse', cmd_parse)
  seneca.add('role:github,cmd:extract', cmd_extract)

  return {
    name: 'nodezoo-github'
  }
}

function cmd_get (args, done) {
  var seneca = this

  var github_name = args.name
  var github_ent = seneca.make$('github')

  var url = opts.registry + github_name
  // check if in the cache
  github_ent.load$(github_name, function (err, github) {
    if (err) {
      return done(err)
    }
    if (github && !args.update) {
      return done(null, github)
    }
    else {
      // get giturl from npm
      Request.get({url: url, gzip: true}, function (err, res, body) {
        if (err) {
          return done(err)
        }
        else if (_.isEmpty(JSON.parse(body))) {
          return done(err)
        }
        var data = JSON.parse(body)
        // take giturl from npm data
        seneca.act('role:github,cmd:extract', {data: data}, function (err, data) {
          if (err) {
            return done(err)
          }
          // parse username and repo from giturl
          var gitData = cmd_parse(data)

          if (gitData) {
            var user = gitData[1]
            var repo = gitData[2]
            gitUrl = 'http://github.com/' + user + '/' + repo
          }
          if (!user) {
            return done(err)
          }
          else {
            // get github data using github username and repo name
            seneca.act('role:github,cmd:query', {name: github_name, user: user, repo: repo}, done)
          }
        })
      })
    }
  })
}

function cmd_query (args, done) {
  var seneca = this

  var github_ent = seneca.make$('github')
  var github_name = args.name
  var user = args.user
  var repo = args.repo

  github.authenticate({
    type: 'basic',
    username: opts.token,
    password: 'x-oauth-basic'
  })

  github.repos.get({user: user, repo: repo}, function (err, repo) {
    if (err) {
      return done(err)
    }
    var data
    if (repo) {
      var pullRequests = []
      github.pullRequests.getAll({user: user, repo: github_name, state: 'open'}, function (err, response) {
        if (err) {
          console.log(err)
        }
        if (response) {
          pullRequests = response
        }
      })
      data = {
        name: args.repo || '',
        user: args.user || '',
        repo: args.repo || '',
        stars: repo.stargazers_count || '',
        watches: repo.subscribers_count || '',
        forks: repo.forks_count || '',
        last: repo.pushed_at || '',
        url: gitUrl || '',
        gitClone: repo.clone_url || '',
        pullRequests: pullRequests.length || ''
      }
      // update the data if module exists in cache, if not create it
      github_ent.load$(github_name, function (err, github) {
        if (err) {
          return done(err)
        }
        if (github) {
          return github.data$(data).save$(done)
        }
        else {
          data.id$ = github_name
          github_ent.make$(data).save$(done)
        }
      })
    }
    else return done()
  })
}

function cmd_extract (args, done) {
  var data = args.data
  var dist_tags = data['dist-tags'] || {}
  var latest = ((data.versions || {})[dist_tags.latest]) || {}
  var repository = latest.repository || {}

  var out = {
    giturl: repository.url
  }

  done(null, out)
}

function cmd_parse (args) {
  var m = /[\/:]([^\/:]+?)[\/:]([^\/]+?)(\.git)*$/.exec(args.giturl)
  if (m) {
    return (m)
  }
  else {
    return null
  }
}
