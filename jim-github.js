/**
 * GitHub JIRA Issue Helper Functions
 */

// externally defined modules
var GitHub      = require("github");
var moment      = require('moment');
var Promise     = require("bluebird");
var randomColor = require("randomcolor");
var request     = require('request-promise');
var retry       = require('bluebird-retry');

// constants
var USER_AGENT = 'JIM: brian.oliver@oracle.com';
var REQUEST_DELAY = 500;  // half a second

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

/**
 * Creates a Collaborator in the repository.
 */
function createCollaborator(github, username, repository, collaborator)
{
    return new Promise(function (resolve, reject) {

        github.repos.addCollaborator({ owner:username, repo:repository, username:collaborator, permission:"pull"}, function (error, response)
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
    return getIssue(github, username, repository, issue.new_id)
        .then(function(existing) {

            var jiraProject = issue.project;
            var jiraIssue = issue.old_id;

            console.log("Skipping JIRA Issue: " + issue.old_id + " as a GitHub Issue already exists");

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

        var jiraProject = issue.project;
        var jiraIssue = issue.old_id;
        var githubIssue = issue.new_id;

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

        // ensure the assignee is a known collaborator
        if (!(issue.assignee in collaborators)) {
            // Add a comment storing the old assignee who is not a collaborator
            if (issue.assignee) {
                issue.labels.push("ERR: Assignee");
                comments.push({
                    created_at: issue.created_at,
                    body: "Was assigned to " + issue.assignee
                });
                // assign the issue the default username
                issue.assignee = defaultusername;
            }
        }

        // add a comment indicating the issue was automatically imported
        comments.push({
            created_at: new Date(),
            body: "This issue was imported from java.net JIRA " + issue.project + "-" + issue.old_id
        });

        // add a comment indicating the resolution
        if (issue.closed && issue.resolution) {
            comments.push({
                created_at: issue.closed_at,
                body: "Marked as **" + issue.resolution.toLowerCase() +
                "** on " + moment(issue.closed_at).format("dddd, MMMM Do YYYY, h:mm:ss a")
            });
        }

        // ensure the issue has a body
        if (!issue.body || issue.body == "")
        {
            issue.body = issue.title;
        }

        // remove JIRA specific properties
        delete issue.old_id;
        delete issue.new_id;
        delete issue.project;
        delete issue.reporter;
        delete issue.resolution;
        delete issue.fixVersion;

        if (!(issue.assignee)) {
            delete issue.assignee;
        }

        // create the issue using the issue importer API
        var postRequestOptions = {
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

        var getRequestOptions = {
            method: 'GET',
            headers: {
                'Authorization': "token " + token,
                'Accept': "application/vnd.github.golden-comet-preview+json",
                'User-Agent': USER_AGENT
            },
            json: true
        };

        console.log("Importing Issue: " + jiraIssue);

        console.log(issue);
        console.log(comments);

        retry(function() {
            return request(postRequestOptions)
                .then(function (body) {
                    if (body.id) {
                        console.log("Migrating JIRA " + jiraProject + "-" + jiraIssue + ".  Created GitHub Request: " + body.id + ". (" + body.status + ")");

                        response.write("Created GitHub Request " + body.id + ".  ");

                        // wait until the issue is imported
                        // options for the status request
                        getRequestOptions.uri = body.url;

                        return retry(function() {
                            return request(getRequestOptions)
                                .then(function(body) {
                                    switch(body.status) {
                                        case "imported":
                                            var githubIssue = body.issue_url.split("/").pop();
                                            return Promise.resolve(githubIssue);
                                        case "failed":
                                            console.log("$$$$ ERROR $$$$");
                                            console.log(postRequestOptions);
                                            console.log(body);
                                            if(body.errors) {
                                                if(body.errors[0].resource == "Internal Error") {
                                                    throw new retry.StopError('internal_error');
                                                }
                                                else {
                                                    throw new retry.StopError('other_error');
                                                }
                                            }
                                            else {
                                                return Promise.reject(new Error(JSON.stringify(body)));
                                            }
                                        default:
                                            return Promise.reject(new Error('JIRA Issue migration still pending.  Last result:' + JSON.stringify(body)));
                                    }
                                });
                        }, { timeout: timeout })
                            .then(function(githubIssue) {
                                return Promise.resolve(githubIssue);
                            })
                            .catch(function(error) {
                                if(error.message) {
                                    if(error.message == "other_error") {
                                        console.log("Request Failed due to some other error. Check logs");
                                        throw new retry.StopError('other_error');
                                    }
                                }
                                console.log("Request Failed. Will retry again");
                                return Promise.reject(new Error(error));
                            });
                    } else {
                        console.log("Failed to migrate JIRA Issue: " + jiraIssue + " because: " + body.message);

                        response.write("Failed to migrate JIRA Issue " + jiraIssue + " because: " + body.message + "</p>");

                        reject(body);
                    }
                })

        }, {max_tries: -1})
            .then(function(githubIssue) {
                console.log("Created GitHub Issue #" + githubIssue + " for JIRA Issue: " + jiraIssue)

                response.write("Successfully created GitHub Issue # " + githubIssue + ".</p>");

                resolve(githubIssue);
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

        github.repos.getCollaborators({owner: username, repo: repository, per_page: 100}, function (error, response) {
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


/**
 * Imports the specified JIRA project into a GitHub Issue tracking system.
 * 
 * @param project
 */
function importJIRAProject(project, response) {

    // the github timeout (2 minutes)
    var timeout = 120000;

    // ----- connect and authenticate to github -----

    response.write("<p>Connecting to Github Repository <b>" + project.repository +
                   "</b> on behalf of <b>" + project.username +
                   "</b> using token <b>" + project.token + "</b></p>");

    var github = new GitHub({
        // required
        version: "3.0.0",
        // optional
        debug: false,
        protocol: "https",
        host: "api.github.com",
        timeout: timeout,
        headers: {
            "user-agent": USER_AGENT
        }
    });

    github.authenticate({
        type: "token",
        token: project.token
    });

    // acquire the repository
    github.repos.get({ owner: project.username, repo: project.repository}, function (error, data)
    {
        if (error)
        {
            response.write("<p>Failed to perform migration.  GitHub reported the following error: " + error + "</p>");
            response.end();
        }
        else
        {
            response.write("<p>Connected to Github.  Commencing Issue Creation.</p>");

            // the milestones and collaborators known to github for the project
            var milestones    = {};
            var collaborators = {};

            // an array of initialization promises
            // (these need to be complete before we can start creating issues)
            var initialization = [];

            // ----- create the versions as milestones -----

            response.write("<p>Creating JIRA Versions as GitHub Milestones.</p>");

            initialization.push(
                Promise.each(project.versions, function(version) {
                    return Promise.delay(REQUEST_DELAY, createMilestone(github, project.username, project.repository, version));
                }).then(function() {
                    response.write("<p>All Versions Created</p>");
                }));

            // ----- create the components as labels -----

            response.write("<p>Creating JIRA Components as GitHub Labels</p>");

            initialization.push(
                Promise.each(project.components, function(component) {
                    return Promise.delay(REQUEST_DELAY, createLabel(github, project.username, project.repository, "Component: " +  component));
                }).then(function() {
                    response.write("<p>All Components Created</p>");
                }));

            // ----- create the types as labels -----

            response.write("<p>Creating JIRA Issue Types as GitHub Labels</p>");

            initialization.push(
                Promise.each(project.types, function(type) {
                    return Promise.delay(REQUEST_DELAY, createLabel(github, project.username, project.repository, "Type: " + type));
                }).then(function() {
                    response.write("<p>All Issue Types Created</p>");
                }));

            // ----- create the priorities as labels -----

            response.write("<p>Creating JIRA Priorities as GitHub Labels</p>");

            initialization.push(
                Promise.each(project.priorities, function(priority) {
                    return Promise.delay(REQUEST_DELAY, createLabel(github, project.username, project.repository, "Priority: " + priority));
                }).then(function() {
                    response.write("<p>All Priorities Created</p>");
                }));

            // acquire the known collaborators
            initialization.push(getCollaborators(github, project.username, project.repository, collaborators));

            Promise.all(initialization).then(function() {

                return getMilestones(github, project.username, project.repository, milestones);

            }).then(function() {
                console.log("Creating GitHub Issues for JIRA Issues");

                // create the issues
                return Promise.each(project.issues, function(issue) {
                    return Promise.delay(REQUEST_DELAY, createIssueIfAbsent(github, project.username, project.token, project.repository, issue.issue, issue.comments, milestones, collaborators, timeout, response, project.defaultusername));
                });

            }).then(function () {

                response.write("<p>Completed Issue Migration!</p>");

                // we're now done
                response.end();
            });
        }
    });
}

/**
 * Create collaborators for the project
 */
function importCollaborators(repository, username, token, collaborators, response) {

    var timeout = 120000;

    // ----- connect and authenticate to github -----

    response.write("<p>Connecting to Github Repository <b>" + repository +
                   "</b> on behalf of <b>" + username +
                   "</b> using token <b>" + token + "</b></p>");

    var github = new GitHub({
        // required
        version: "3.0.0",
        // optional
        debug: false,
        protocol: "https",
        host: "api.github.com",
        timeout: timeout,
        headers: {
            "user-agent": USER_AGENT
        }
    });

    github.authenticate({
        type: "token",
        token: token
    });

    // acquire the repository
    github.repos.get({ owner: username, repo: repository}, function (error, data)
    {
        if (error)
        {
            response.write("<p>Failed to perform migration.  GitHub reported the following error: " + error + "</p>");
            response.end();
        }

        // an array of initialization promises
        // (these need to be complete before we can start creating issues)
        var initialization = [];

        response.write("<p>Adding collaborators to the project</p>")
        initialization.push(
            Promise.each(collaborators, function(collaborator) {
                return Promise.delay(REQUEST_DELAY, createCollaborator(github, username, repository, collaborator));
            }).then(function() {
                response.write("<p>All Collaborators Created</p>");
            }));

        Promise.all(initialization).then(function() {
                response.write("<p>Completed Collaborators Migration!</p>");
                response.end();
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

exports.importJIRAProject   = importJIRAProject;
exports.importCollaborators = importCollaborators;

exports.USER_AGENT          = USER_AGENT;
