// npm defined and provided modules
var bodyParser      = require('body-parser');
var cookieParser    = require('cookie-parser');
var express         = require('express');
var favicon         = require('serve-favicon');
var GitHub          = require("github");
var https           = require('https');
var logger          = require('morgan');
var moment          = require('moment');
var path            = require('path');
var Promise         = require("bluebird");
var request         = require('request-promise');
var retry           = require('bluebird-retry');
var session         = require('express-session');
var xmldoc          = require('xmldoc');
var readline        = require('readline');
var fs              = require('fs');

// locally defined and provided modules
var childValuesFrom         = require('./jim-xml').childValuesFrom;

var jiraDateFormat          = require('./jim-jira').jiraDateFormat;
var jiraDateFrom            = require('./jim-jira').jiraDateFrom;
var jiraDateToJavaScript    = require('./jim-jira').jiraDateToJavaScript;
var jiraHtmlToMarkdown      = require('./jim-jira').jiraHtmlToMarkdown;
var jiraGetProjectList      = require('./jim-jira').jiraGetProjectList;

var toString                = require('./jim-strings').toString;
var splitID                 = require('./jim-strings').splitID;

var createIssueIfAbsent     = require('./jim-github').createIssueIfAbsent;
var createLabel             = require('./jim-github').createLabel;
var createMilestone         = require('./jim-github').createMilestone;
var createCollaborator      = require('./jim-github').createCollaborator;
var getCollaborators        = require('./jim-github').getCollaborators;
var getIssue                = require('./jim-github').getIssue;
var getMilestones           = require('./jim-github').getMilestones;

var USER_AGENT              = require('./jim-github').USER_AGENT;

// define our application
var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: 'it cant take any more jim',
    cookie: {},
    resave: false,
    saveUninitialized: false
}));

app.get('/', function(req, res){
    // Call the jiraGetProjectList function to get the list of projects from java.net
    jiraGetProjectList.then(function(json) {
        // when the list of projects comes back render the page, passing the project list json to the template
        res.render('index', {"jiraProjectList" : json})
    })
});

app.use(express.static(path.join(__dirname, 'public')));

// Fill in this user name map from the file mapping.txt
var username_map = {};

var rl = readline.createInterface({
    input: fs.createReadStream('mapping.txt')
});

rl.on('line', (line) => {
    [javanet_id, gh_id] = line.split(" ");
    username_map[javanet_id] = gh_id;
});

app.post('/collaborators', function(req, res) {
    var timeout = 60000;

    var repository      = req.body.repository;
    var username        = req.body.username;
    var token           = req.body.token;

    var new_collaborators = new Set();

    for (var key in username_map) {
        new_collaborators.add(username_map[key])
    }

    console.log("Importing collaborators")

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
            res.write("<p>Failed to perform migration.  GitHub reported the following error: " + error + "</p>");
            res.end();
        }

        // an array of initialization promises
        // (these need to be complete before we can start creating issues)
        var initialization = [];

        res.write("<p>Adding collaborators to the project</p>")
        initialization.push(
            Promise.each(new_collaborators, function(collaborator) {
                return createCollaborator(github, username, repository, collaborator);
            }).then(function() {
                res.write("<p>All Collaborators Created</p>");
            }));

        Promise.all(initialization).then(function() {
                res.write("<p>Completed Collaborators Migration!</p>");
                res.end();
            });
    });

});

app.post('/migrate', function (req, res) {

    var timeout = 60000;

    var session = req.session;

    var project         = req.body.project;
    var repository      = req.body.repository;
    var username        = req.body.username;
    var defaultusername = req.body.defaultusername;
    var token           = req.body.token;

    var url = "https://java.net/jira/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=project+%3D+" + project + "&tempMax=1000";

    console.log("Requested Migration of Project [" + project + "] from [" + url + "]");

    res.write("<p>Retrieving Issues from java.net for <b>" + project + "</b>. Please wait.</p>");

    https.get(url, function(javanet) {
        var xml = '';

        javanet.on('data', function(chunk) {
            xml += chunk;
        });

        javanet.on('error', function(e) {
            console.log(e);

            res.sendStatus(500);
        });

        javanet.on('timeout', function(e) {
            console.log(e);

            res.sendStatus(500);
        });

        javanet.on('end', function() {

            res.write("<p>Retrieved Issues from java.net for <b>" + project + "</b></p>");

            //parse the xml
            var xmlJiraExport = new xmldoc.XmlDocument(xml);

            var xmlChannel = xmlJiraExport.childNamed("channel");
            var xmlItems = xmlChannel.childrenNamed("item");

            // ----- analyse the issues to determine meta-information -----

            res.write("<p>Analysing " + xmlItems.length + " JIRA Issues for Migration</p>");

            var versions = new Set();
            var components = new Set();
            var assignees = new Set();
            var types = new Set();
            var statuses = new Set();
            var resolutions = new Set();
            var priorities = new Set();
            var projects = new Set();

            xmlItems.forEach(function(xmlItem)
            {
                childValuesFrom(xmlItem, "project", projects);
                childValuesFrom(xmlItem, "version", versions);
                childValuesFrom(xmlItem, "fixVersion", versions);
                childValuesFrom(xmlItem, "component", components);
                childValuesFrom(xmlItem, "assignee", assignees);
                childValuesFrom(xmlItem, "reporter", assignees);
                childValuesFrom(xmlItem, "type", types);
                childValuesFrom(xmlItem, "status", statuses);
                childValuesFrom(xmlItem, "resolution", resolutions);
                childValuesFrom(xmlItem, "priority", priorities);
            });

            // clean up assignees and types
            assignees.delete("Unassigned");
            types.delete("Epic");

            res.write("<p>Discovered Projects: " + toString(projects) + "</p>");
            res.write("<p>Discovered Versions: " + toString(versions) + "</p>");
            res.write("<p>Discovered Components: " + toString(components) + "</p>");
            res.write("<p>Discovered Assignees: " + toString(assignees) + "</p>");
            res.write("<p>Discovered Types: " + toString(types) + "</p>");
            res.write("<p>Discovered Statuses: " + toString(statuses) + "</p>");
            res.write("<p>Discovered Resolutions: " + toString(resolutions) + "</p>");
            res.write("<p>Discovered Priorities: " + toString(priorities) + "</p>");

            // ----- create a JSON representation of the issues -----

            // Note: this JSON representation is almost exactly as required
            // for bulk import.  Some information is extraneous and will be removed
            // from the JSON representation.  Some information is incomplete
            // and will be corrected prior to creating the issues.

            res.write("<p>Preparing " + xmlItems.length + " JIRA Issues for Github</p>");

            var issues = [];

            xmlItems.forEach(function(xmlItem)
            {
                var issue = {};

                // determine the JIRA Project and Issue ID
                var key = xmlItem.childNamed("key").val;
                [issue.project, issue.id] = splitID(key);

                issue.title = xmlItem.childNamed("summary").val;
                issue.body = jiraHtmlToMarkdown(xmlItem.childNamed("description").val, issue.project).trim();
                issue.created_at = jiraDateFrom(xmlItem, "created");
                issue.closed_at = jiraDateFrom(xmlItem, "resolved");

                status = xmlItem.childNamed("status").val.toLowerCase()
                issue.closed = (status == "closed" || status == "resolved") ? true : false;

                // the fix version will eventually become the milestone
                var xmlFixVersion = xmlItem.childNamed("fixVersion");
                if (xmlFixVersion)
                {
                    issue.fixVersion = xmlFixVersion.val;
                }

                // establish the labels
                issue.labels = [];

                childValuesFrom(xmlItem, "type", issue.labels);
                childValuesFrom(xmlItem, "priority", issue.labels);
                childValuesFrom(xmlItem, "component", issue.labels);
                childValuesFrom(xmlItem.childNamed("labels") , "label", issue.labels)
                // Custom field - Tags
                var tagsNode = xmlItem.childNamed("customfields").childWithAttribute("id", "customfield_10002")
                if(tagsNode) {
                    childValuesFrom(tagsNode.childNamed("customfieldvalues") , "label", issue.labels)
                }

                // extract the assignee and reporter
                issue.assignee = xmlItem.childNamed("assignee").attr.username;
                issue.reporter = xmlItem.childNamed("reporter").attr.username;
                if(issue.assignee in username_map)
                    issue.assignee = username_map[issue.assignee]

                if(issue.reporter in username_map)
                    issue.reporter = username_map[issue.reporter]

                // extract the resolution
                if (xmlItem.childNamed("resolution")) {
                    issue.resolution = xmlItem.childNamed("resolution").val;
                }

                // ----- extract the comments ------

                var comments = [];

                var xmlComments = xmlItem.childNamed("comments");

                if (xmlComments)
                {
                    xmlComments = xmlComments.childrenNamed("comment");

                    xmlComments.forEach(function(xmlComment) {
                        var author = xmlComment.attr.author;
                        if(author in username_map)
                            author = username_map[author]
                        var created = jiraDateToJavaScript(xmlComment.attr.created);
                        var body = jiraHtmlToMarkdown(xmlComment.val, issue.project);

                        comments.push({
                            created_at: created,
                            body: (author in username_map ? "@" : "") + author + " said:\n" + body
                        });
                    });
                }

                // ----- extract all attachments and add as comments -----
                // TODO: Change the url to the new location
                var xmlAttachments = xmlItem.childNamed("attachments")

                if(xmlAttachments) {

                    xmlAttachments = xmlAttachments.childrenNamed("attachment");

                    xmlAttachments.forEach(function(xmlAttachment) {
                        var created = jiraDateToJavaScript(xmlAttachment.attr.created);
                        var author = xmlAttachment.attr.author;
                        if(author in username_map)
                            author = username_map[author]
                        var url = "https://java.net/jira/secure/attachment/" + xmlAttachment.attr.id  + "/" + xmlAttachment.attr.name;
                        var body = "File: [" + xmlAttachment.attr.name + "](" + url + ")\n";
                        body += "Attached By: " + (author in username_map ? "@" : "") + author + "\n";

                        comments.push({
                            created_at: created,
                            body: body
                        });
                    })
                }

                tmp_project = ""
                tmp_id = ""
                // ----- extract all sub-tasks and add as comments -----
                subtasks = [];
                childValuesFrom(xmlItem.childNamed("subtasks"), "subtask", subtasks)
                tmp_body = "Sub-Tasks:\n";
                for (var i = 0; i < subtasks.length; i++) {
                    [tmp_project, tmp_id] = splitID(subtasks[i]);
                    tmp_url = "https://github.com/" + username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
                    tmp_body += "[" + subtasks[i] + "](" + tmp_url + ")\n";
                }
                if(subtasks.length != 0) {
                    comments.push({
                        created_at: issue.created_at,
                        body: tmp_body
                    });
                }

                // ----- extract the parent task and add as comment -----
                var parent = xmlItem.childNamed("parent")

                if(parent) {
                    tmp_body = "Parent-Task: ";
                    [tmp_project, tmp_id] = splitID(parent.val);
                    tmp_url = "https://github.com/" + username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
                    tmp_body += "[" + parent.val + "](" + tmp_url + ")\n";
                    comments.push({
                        created_at: issue.created_at,
                        body: tmp_body
                    });
                }

                // ----- extract all issue-links and add as comments -----
                var xmlLinks = xmlItem.childNamed("issuelinks")
                tmp_body = "Issue-Links:\n"
                if(xmlLinks) {
                    xmlLinks = xmlLinks.childrenNamed("issuelinktype");
                    if(xmlLinks) {
                        xmlLinks.forEach(function(xmlLink) {
                            var outwardLinks = xmlLink.childNamed("outwardlinks");
                            var inwardLinks = xmlLink.childNamed("inwardlinks");
                            if(outwardLinks) {
                                tmp_body += outwardLinks.attr.description + "\n";
                                outwardLinks.childrenNamed('issuelink').forEach(function(issuelink){
                                    tmp_key = issuelink.valueWithPath('issuekey');
                                    [tmp_project, tmp_id] = splitID(tmp_key);
                                    tmp_url = "https://github.com/" + username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
                                    tmp_body += "[" + tmp_key + "](" + tmp_url + ")\n";
                                });
                            }
                            if(inwardLinks) {
                                tmp_body += inwardLinks.attr.description + "\n";
                                inwardLinks.childrenNamed('issuelink').forEach(function(issuelink){
                                    tmp_key = issuelink.valueWithPath('issuekey');
                                    [tmp_project, tmp_id] = splitID(tmp_key);
                                    tmp_url = "https://github.com/" + username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
                                    tmp_body += "[" + tmp_key + "](" + tmp_url + ")\n";
                                });
                            }
                        })
                        comments.push({
                            created_at: issue.created_at,
                            body: tmp_body
                        });
                    }
                }

                issues.push({"issue": issue, "comments": comments});
            });

            res.write("<p>Sorting " + xmlItems.length + " JIRA Issues (by key) for creation on Github</p>");

            issues.sort(function(issueA, issueB) {
                return issueA.issue.id - issueB.issue.id;
            });

            res.write("<p>Creating " + xmlItems.length + " JIRA Issues on Github</p>");

            // ----- connect and authenticate to github -----

            res.write("<p>Connecting to Github Repository <b>" + repository +
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
                    res.write("<p>Failed to perform migration.  GitHub reported the following error: " + error + "</p>");
                    res.end();
                }
                else
                {
                    res.write("<p>Connected to Github.  Commencing Issue Creation.</p>");

                    // the milestones and collaborators known to github for the project
                    var milestones    = {};
                    var collaborators = {};

                    // an array of initialization promises
                    // (these need to be complete before we can start creating issues)
                    var initialization = [];

                    // ----- create the versions as milestones -----

                    res.write("<p>Creating JIRA Versions as GitHub Milestones.</p>");

                    initialization.push(
                        Promise.each(versions, function(version) {
                            return createMilestone(github, username, repository, version);
                        }).then(function() {
                            res.write("<p>All Versions Created</p>");
                        }));

                    // ----- create the components as labels -----

                    res.write("<p>Creating JIRA Components as GitHub Labels</p>");

                    initialization.push(
                        Promise.each(components, function(component) {
                            return createLabel(github, username, repository, component);
                        }).then(function() {
                            res.write("<p>All Components Created</p>");
                        }));

                    // ----- create the types as labels -----

                    res.write("<p>Creating JIRA Issue Types as GitHub Labels</p>");

                    initialization.push(
                        Promise.each(types, function(type) {
                            return createLabel(github, username, repository, type);
                        }).then(function() {
                            res.write("<p>All Issue Types Created</p>");
                        }));

                    // ----- create the priorities as labels -----

                    res.write("<p>Creating JIRA Priorities as GitHub Labels</p>");

                    initialization.push(
                        Promise.each(priorities, function(priority) {
                            return createLabel(github, username, repository, priority);
                        }).then(function() {
                            res.write("<p>All Priorities Created</p>");
                        }));

                    // acquire the known collaborators
                    initialization.push(getCollaborators(github, username, repository, collaborators));

                    Promise.all(initialization).then(function() {

                        return getMilestones(github, username, repository, milestones);

                    }).then(function() {
                        console.log("Creating GitHub Issues for JIRA Issues");

                        // create the issues
                        return Promise.each(issues, function(issue) {
                            return createIssueIfAbsent(github, username, token, repository, issue.issue, issue.comments, milestones, collaborators, timeout, res, defaultusername);
                        });

                    }).then(function () {

                        res.write("<p>Completed Issue Migration!</p>");

                        // we're now done
                        res.end();
                    });
                }
            });
        });
    });

});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
