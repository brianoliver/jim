/**
 * JIRA Content Conversion Functions
 */

// externally defined modules
var fetch      = require('node-fetch');
var https      = require('https');
var moment     = require('moment');
var Promise    = require("bluebird");
var request    = require('request-promise');
var toMarkdown = require('to-markdown');
var xmldoc     = require('xmldoc');

// locally defined modules
var childValuesFrom = require('./jim-xml').childValuesFrom;
var splitID         = require('./jim-strings').splitID;

// constants
var jiraDateFormat = 'ddd, DD MMM YYYY HH:mm:ss ZZ';

/**
 * Asynchronously requests JIRA to export issues for a known project in the specified
 * range, adding each exported issue (in Xml format) to the array of xmlDocuments.
 * 
 * @param projectName
 * @param firstIssue
 * @param lastIssue
 * @param xmlDocuments
 */
function jiraExportIssuesAsXml(projectName, firstIssue, lastIssue, xmlDocuments) {

    // create an array of starting issues so we can batch concurrent requests to JIRA
    var batchSize = 50;
    var startingIssues = [];

    for (var i = firstIssue; i <= lastIssue; i = i + batchSize) {
        startingIssues.push(i);
    }

    return Promise.each(
        startingIssues,
        function (startingIssue) {

            // create an array of issues to concurrently request from JIRA
            var issues = [];
            for (var i = startingIssue; i < startingIssue + batchSize && i <= lastIssue; i++) {
                issues.push(i);
            }

            return Promise.map(issues,  function (issue) {
                // create a JQL query to request the required issue
                var jql = "PROJECT+%3D+" + projectName+ "+AND+ISSUE=" + projectName + "-" + issue;

                // create a URL for an xml based JQL query
                var url = "https://java.net/jira/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=" + jql;

                // create a promise that can concurrently request the issue from JIRA
                return request(url)
                    .then(function (html) {
                        console.log("Retrieved Issue " + projectName + "-" + issue);
                        xmlDocuments.push(html);
                    })
                    .catch(function (err) {
                        console.log("Oops! Failed to load issue " + projectName + "-" + issue + " due to " + err);

                        // TODO: create a place-holder issue as we assume the issue is not available
                    });
            });
        }
    );
}

/**
 * Processes the Xml-based JIRA export, updating the JSON-based project
 * with information extracted from the export.
 * 
 * @param xml      xml string of a JIRA xml-bases issue export
 * @param project  the JSON representation of the JIRA project
 */
function jiraProcessXmlExport(xml, project) {

    //parse the xml
    var xmlJiraExport = new xmldoc.XmlDocument(xml);

    var xmlChannel = xmlJiraExport.childNamed("channel");
    
    var xmlItems = xmlChannel.childrenNamed("item");

    // ----- analyse the issues to determine meta-information -----

    xmlItems.forEach(function(xmlItem)
    {
        childValuesFrom(xmlItem, "project", project.projects);
        childValuesFrom(xmlItem, "version", project.versions);
        childValuesFrom(xmlItem, "fixVersion", project.versions);
        childValuesFrom(xmlItem, "component", project.components);
        childValuesFrom(xmlItem, "assignee", project.assignees);
        childValuesFrom(xmlItem, "reporter", project.assignees);
        childValuesFrom(xmlItem, "type", project.types);
        childValuesFrom(xmlItem, "status", project.statuses);
        childValuesFrom(xmlItem, "resolution", project.resolutions);
        childValuesFrom(xmlItem, "priority", project.priorities);
    });

    // clean up assignees and types
    project.assignees.delete("Unassigned");
    project.types.delete("Epic");

    // ----- create a JSON representation of the issues in the export -----

    // Note: this JSON representation is almost exactly as required
    // for bulk import.  Some information is extraneous and will be removed
    // from the JSON representation.  Some information is incomplete
    // and will be corrected prior to creating the issues.

    // res.write("<p>Preparing " + xmlItems.length + " JIRA Issues for Github</p>");

    xmlItems.forEach(function(xmlItem)
    {
        var issue = {};

        // determine the JIRA Project and Issue ID
        var key = xmlItem.childNamed("key").val;
        [issue.project, issue.id] = splitID(key);

        issue.title = xmlItem.childNamed("summary").val;
        issue.body = jiraHtmlToMarkdown(xmlItem.childNamed("description").val, issue.project).trim();
        environment = jiraHtmlToMarkdown(xmlItem.childNamed("environment").val);
        issue.body += "\n#### Environment\n" + environment;
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

        childValuesFrom(xmlItem, "type", issue.labels, "Type: ");
        childValuesFrom(xmlItem, "priority", issue.labels, "Priority: ");
        childValuesFrom(xmlItem, "component", issue.labels, "Component: ");
        childValuesFrom(xmlItem.childNamed("labels") , "label", issue.labels);
        
        // Custom field - Tags
        var tagsNode = xmlItem.childNamed("customfields").childWithAttribute("id", "customfield_10002");
        if(tagsNode) {
            childValuesFrom(tagsNode.childNamed("customfieldvalues") , "label", issue.labels);
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

        if (xmlComments) {
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
            tmp_url = "https://github.com/" + project.username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
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
            tmp_url = "https://github.com/" + project.username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
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
                            tmp_url = "https://github.com/" + project.username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
                            tmp_body += "[" + tmp_key + "](" + tmp_url + ")\n";
                        });
                    }
                    if(inwardLinks) {
                        tmp_body += inwardLinks.attr.description + "\n";
                        inwardLinks.childrenNamed('issuelink').forEach(function(issuelink){
                            tmp_key = issuelink.valueWithPath('issuekey');
                            [tmp_project, tmp_id] = splitID(tmp_key);
                            tmp_url = "https://github.com/" + project.username + "/" + tmp_project.toLowerCase() + "/issues/" + tmp_id;
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

        project.issues.push({"issue": issue, "comments": comments});
    });
}


function jiraDateToJavaScript(jiraDate)
{
    return moment(jiraDate, jiraDateFormat).format();
}


function jiraDateFrom(xmlFromElement, elementName)
{
    var xmlElement = xmlFromElement.childNamed(elementName);

    if (xmlElement)
    {
        return jiraDateToJavaScript(xmlElement.val);
    }
    else
    {
        return;
    }
}


/**
 * A function to convert JIRA produced HTML for a specific project (JIRA-KEY) into Markdown.
 */
function jiraHtmlToMarkdown(html, projectKey)
{
    // custom converters for html to markdown
    var untagConverter = {
        filter: ["span", "pre", "del", "div"],
        replacement: function(content) {
            return content;
        }
    };

    var codePanelConverter = {
        filter: function(node) {
            return node.nodeName === "DIV" && (node.getAttribute("class") === "code panel" || node.getAttribute("class") === "preformatted panel");
        },
        replacement: function(content) {

            content = content.trim();

            if (content.charAt(content.length - 1) != "\n") {
                content = content + "\n";
            }

            return "```\n" + content + "```\n";
        }
    };

    // convert the description into markdown
    var markdown = toMarkdown(html, {converters: [codePanelConverter, untagConverter], gfm:true});

    // remove unnecessary indentation in code blocks
    markdown = markdown.replace(/                /g, "");

    // replace/refactor links to JIRAs into links to GitHub Issues
    markdown = markdown.replace(new RegExp("\\[" + projectKey + "-([0-9]*)\\]\\([^\\)]*\\)", "g"), "#$1");

    return markdown;
}

var jiraGetProjectList = fetch('https://java.net/jira/rest/api/2/project')
    .then(function(res) {
        return res.json();
    });


exports.jiraDateFormat        = jiraDateFormat;
exports.jiraDateFrom          = jiraDateFrom;
exports.jiraDateToJavaScript  = jiraDateToJavaScript;
exports.jiraHtmlToMarkdown    = jiraHtmlToMarkdown;
exports.jiraGetProjectList    = jiraGetProjectList;
exports.jiraExportIssuesAsXml = jiraExportIssuesAsXml;
exports.jiraProcessXmlExport  = jiraProcessXmlExport;