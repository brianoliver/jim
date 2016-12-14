/**
 * JIRA Content Conversion Functions
 */

var moment = require('moment');
var toMarkdown = require('to-markdown');

var jiraDateFormat = 'ddd, DD MMM YYYY HH:mm:ss ZZ';

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
            return node.nodeName === "DIV" && node.getAttribute("class") === "code panel";
        },
        replacement: function(content) {

            content = content.trim();

            if (content.charAt(content.length - 1) != "\n") {
                content = content + "\n";
            }

            return "```\n" + content + "```";
        }
    };

    // convert the description into markdown
    var markdown = toMarkdown(html, {converters: [codePanelConverter, untagConverter], gfm:true});

    // remove unnecessary indentation in code blocks
    markdown = markdown.replace(/                /g, "");

    // replace/refactor links to JIRAs into links to GitHub Issues
    markdown = markdown.replace(new RegExp("\\[" + projectKey + "-(.*)\\]\\(.*\\)", "g"), "#$1");

    return markdown;
}

exports.jiraDateFormat       = jiraDateFormat;
exports.jiraDateFrom         = jiraDateFrom;
exports.jiraDateToJavaScript = jiraDateToJavaScript;
exports.jiraHtmlToMarkdown   = jiraHtmlToMarkdown;