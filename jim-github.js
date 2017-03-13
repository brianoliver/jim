/**
 * GitHub JIRA Issue Helper Functions
 */

var moment      = require('moment');
var Promise     = require("bluebird");
var randomColor = require("randomcolor");
var request     = require('request-promise');
var retry       = require('bluebird-retry');

// constants
var USER_AGENT = 'JIM: brian.oliver@oracle.com';

/**
 * Creates a GitHub Milestone.
 */
function createMilestone(github, username, repository, title) {
    return new Promise(function (resolve, reject) {
        github.issues.createMilestone({owner: username, repo: repository, title: title}, function (error, response) {
            if (error) {
                // when the milestone already exists we carry on
                if (error.message.search("already_exists")) {
                    return resolve();
                } else {
                    return reject(error);
                }
            } else {
                return resolve();
            }
        });
    });
}


/**
 * Creates a GitHub Label.
 */
function createLabel(github, username, repository, name, color)
{
    return new Promise(function (resolve, reject) {

        // ensure we have a color
        if (typeof color == "undefined")
        {
            color = randomColor();
        }

        // ensure the color doesn't have a leading #
        if (color.charAt(0) == "#")
        {
            color = color.substr(1);
        }

        github.issues.createLabel({ owner:username, repo:repository, name: name, color:color}, function (error, response)
        {
            if (error) {
                // when label already exists we carry on
                if (error.message.search("already_exists")) {
                    return resolve();
                } else {
                    return reject(error);
                }
            } else {
                return resolve();
            }
        });
    });
}


function getIssue(github, username, repository, number) {
    return new Promise(function (resolve, reject) {
        github.issues.get({ owner:username, repo:repository, number:number}, function(error, response) {
            if (error) {
                return reject(error);
            } else {
                return resolve(response);
            }
        });
    });
}


function createIssueIfAbsent(github, username, token, repository, issue, comments, milestones, collaborators, timeout, response, defaultusername) {
    return getIssue(github, username, repository, issue.id)
        .then(function(existing) {

            var jiraProject = issue.project
            var jiraIssue = issue.id;

            console.log("Skipping JIRA Issue: " + issue.id + " as a GitHub Issue already exists");

            response.write("<p>Skipping the migration of JIRA " + jiraProject + "-" + jiraIssue + " as it already exists.</p>");

            return Promise.resolve();
        })
        .catch(function(error) {
            return createIssue(github, username, token, repository, issue, comments, milestones, collaborators, timeout, response, defaultusername)
        });
}


/**
 * Creates a GitHub Issue.
 */
function createIssue(github, username, token, repository, issue, comments, milestones, collaborators, timeout, response, defaultusername)
{
    return new Promise(function (resolve, reject) {

        var jiraProject = issue.project
        var jiraIssue = issue.id;

        console.log("Migrating JIRA Issue: " + jiraIssue + " to GitHub");

        response.write("<p>Creating GitHub issue for JIRA " + jiraProject + "-" + jiraIssue + ".  ");

        // create milestone (when there's a fix version)
        if (issue.fixVersion) {
            // determine the GitHub milestone for the fix version.
            var milestone = milestones[issue.fixVersion];

            if (milestone) {
                issue.milestone = milestone.number;
            }
        }

        // ensure the assignee is a known collaborator (
        if (issue.assignee && (!(issue.assignee in collaborators) || issue.assignee.toLowerCase() == "unassigned")) {
            // assign the issue the default username
            issue.assignee = defaultusername;
        }

        // add a comment indicating the issue was automatically imported
        comments.push({
            created_at: new Date(),
            body: "This issue was imported from java.net JIRA " + issue.project + "-" + issue.id
        });

        // add a comment indicating the reporter (when defined)
        if (issue.reporter && issue.reporter != username) {
            comments.push({
                created_at: issue.created_at,
                body: "Reported by " + (collaborators[issue.reporter] ? "@" : "") + issue.reporter
            });
        };

        // add a comment indicating the resolution
        if (issue.closed && issue.resolution) {
            comments.push({
                created_at: issue.closed_at,
                body: "Marked as **" + issue.resolution.toLowerCase() + "** by " +
                (collaborators[issue.assignee] ? "@" : "") + issue.assignee +
                " on " + moment(issue.closed_at).format("dddd, MMMM Do YYYY, h:mm:ss a")
            });
        }

        // ensure the issue has a body
        if (!issue.body || issue.body == "")
        {
            issue.body = issue.title;
        }

        // remove JIRA specific properties
        delete issue.id;
        delete issue.project;
        delete issue.reporter;
        delete issue.resolution;
        delete issue.fixVersion;

        // create the issue using the issue importer API
        var options = {
            method: 'POST',
            uri: 'https://api.github.com/repos/' + username + '/' + repository + '/import/issues',
            headers: {
                'Authorization': "token " + token,
                'Accept': "application/vnd.github.golden-comet-preview+json",
                'User-Agent': USER_AGENT
            },
            json: true,
            body: {
                'issue': issue,
                'comments': comments
            }
        };

        request(options)
            .then(function (body) {
                if (body.id) {
                    console.log("Migrating JIRA " + jiraProject + "-" + jiraIssue + ".  Created GitHub Request: " + body.id + ". (" + body.status + ")");

                    response.write("Created GitHub Request " + body.id + ".  ");

                    // wait until the issue is imported
                    options.method = 'GET';
                    options.uri = body.url;
                    delete options.body;

                    retry(function() {
                        return request(options)
                            .then(function(body) {
                                switch(body.status) {
                                    case "imported":
                                        var githubIssue = body.issue_url.split("/").pop();
                                        return Promise.resolve(githubIssue);
                                    case "failed":
                                        return Promise.reject(new Error(JSON.stringify(body)));
                                    default:
                                        return Promise.reject(new Error('JIRA Issue migration still pending.  Last result:' + JSON.stringify(body)));
                                }
                            });
                    }, { timeout: timeout })
                        .done(function(githubIssue) {
                            console.log("Created GitHub Issue #" + githubIssue + " for JIRA Issue: " + jiraIssue)

                            response.write("Successfully created GitHub Issue # " + githubIssue + ".</p>");

                            resolve(body);
                        });

                } else {
                    console.log("Failed to migrate JIRA Issue: " + jiraIssue + " because: " + body.message);

                    response.write("Failed to migrate JIRA Issue " + jiraIssue + " because: " + body.message + "</p>");

                    reject(body);
                }
            })
            .catch(function (error) {
                console.log("Failed to migrate JIRA Issue: " + issue + " due to " + error);

                response.write("Failed to migrate JIRA Issue " + issue + " due to " + error + "</p>");

                reject(error);
            });
    });
}


function getCollaborators(github, username, repository, collaborators)
{
    return new Promise(function (resolve, reject) {
        console.log("Obtaining Collaborators from GitHub");

        github.repos.getCollaborators({owner: username, repo: repository}, function (error, response) {
            if (error) {
                return reject(error);
            } else {
                // remember the collaborators
                response.forEach(function(collaborator) {
                    collaborators[collaborator.login] = collaborator;
                });

                return resolve(collaborators);
            }
        });
    });
}


/**
 * Obtains an array of all the Milestones.
 */
function getMilestones(github, username, repository, milestones)
{
    return new Promise(function (resolve, reject) {
        console.log("Obtaining Milestones from GitHub");

        github.issues.getMilestones({owner: username, repo: repository}, function (error, response) {
            if (error) {
                return reject(error);
            } else {
                // add all of the milestones to the local map so we can look them up
                response.forEach(function(milestone) {
                    milestones[milestone.title] = milestone;
                });

                return resolve(milestones);
            }
        });
    });
}


exports.createIssue         = createIssue;
exports.createIssueIfAbsent = createIssueIfAbsent;
exports.createLabel         = createLabel;
exports.createMilestone     = createMilestone;

exports.getCollaborators    = getCollaborators;
exports.getIssue            = getIssue;
exports.getMilestones       = getMilestones;

exports.USER_AGENT          = USER_AGENT;
