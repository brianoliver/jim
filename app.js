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

// locally defined and provided modules
var jiraGetProjectList      = require('./jim-jira').jiraGetProjectList;
var jiraExportIssuesAsXml   = require('./jim-jira').jiraExportIssuesAsXml;
var jiraProcessXmlExport    = require('./jim-jira').jiraProcessXmlExport;

var importJIRAProject       = require('./jim-github').importJIRAProject;

var toString                = require('./jim-strings').toString;
var splitID                 = require('./jim-strings').splitID;

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

app.post('/migrate', function (req, res) {

    var session = req.session;

    var projectName         = req.body.project;
    var repository      = req.body.repository;
    var username        = req.body.username;
    var defaultusername = req.body.defaultusername;
    var token           = req.body.token;

    // determine the number of issues in the project
    var url = "https://java.net/jira/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=project+%3D+" + projectName + "&order+by+created+desc&tempMax=1";

    console.log("Requested Migration of Project [" + projectName + "] from [" + url + "]");

    res.write("<p>Analyzing java.net <b>" + projectName + "</b>. Please wait.</p>");

    // establish an initial JSON representation of the JIRA project, it's issues and migration information
    var project = {};
    project.repository = repository;
    project.name = projectName;
    project.username = username;
    project.defaultusername = defaultusername;
    project.token = token;
    
    project.versions = new Set();
    project.components = new Set();
    project.assignees = new Set();
    project.types = new Set();
    project.statuses = new Set();
    project.resolutions = new Set();
    project.priorities = new Set();
    project.projects = new Set();     // references to other projects
    project.issues = [];

    request(url)
        .then(function (html) {
            //parse the xml
            var xmlQuery = new xmldoc.XmlDocument(html);

            var xmlChannel = xmlQuery.childNamed("channel");

            // determine the total issues based on the range of issue numbers returned
            var xmlIssueRange = xmlChannel.childNamed("issue");
            project.totalIssues = xmlIssueRange.attr.total;

            // determine the items
            var xmlItems = xmlChannel.childrenNamed("item");

            if (xmlItems.length == 1 && project.totalIssues > 0) {
                // determine the last known issue using the last issue key returned
                var xmlItem = xmlItems[0];

                var key = xmlItem.childNamed("key").val;

                [project.name, project.lastIssueId] = splitID(key);

                res.write("<p>Detected " + project.totalIssues + " JIRA Issues to migrate, the last being issue " + project.name + "-" + project.lastIssueId + "</p>");

                // create promises to load each issue
                var xmlDocuments = [];

                console.log("Commencing retrieval of " + project.totalIssues + " issues");

                console.time("Issue Export");
                var promises = jiraExportIssuesAsXml(project.name, 1, project.lastIssueId, xmlDocuments);

                promises.then(function () {
                    console.timeEnd("Issue Export");

                    console.log("Completed export of " + xmlDocuments.length + " issues");

                    // process all of the xml exports
                    xmlDocuments.forEach(function (xmlDocument) {
                        jiraProcessXmlExport(xmlDocument, project);
                    });
                    
                    project.issues.sort(function(issueA, issueB) {
                        return issueA.issue.id - issueB.issue.id;
                    });

                    console.log(project);

                    res.write("<p>Discovered Projects: " + toString(project.projects) + "</p>");
                    res.write("<p>Discovered Versions: " + toString(project.versions) + "</p>");
                    res.write("<p>Discovered Components: " + toString(project.components) + "</p>");
                    res.write("<p>Discovered Assignees: " + toString(project.assignees) + "</p>");
                    res.write("<p>Discovered Types: " + toString(project.types) + "</p>");
                    res.write("<p>Discovered Statuses: " + toString(project.statuses) + "</p>");
                    res.write("<p>Discovered Resolutions: " + toString(project.resolutions) + "</p>");
                    res.write("<p>Discovered Priorities: " + toString(project.priorities) + "</p>");

                    // perform the migration
                    importJIRAProject(project, res);
                });

            } else {
                res.write("<p>No items to migrate</p>");
            }
        })
        .catch(function (html) {
            console.log(html);

            res.sendStatus(500);
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
