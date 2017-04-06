/**
 * String Helper Functions
 */

function toString(collection)
{
    if (collection)
    {
        var result = "";

        collection.forEach(function (element)
        {
            if (result.length > 0)
            {
                result = result + ", ";
            }

            result = result + element.toString();
        });

        return "[" + result + "]";
    }
    else
    {
        return "[]";
    }
};

function splitID(issueID)
{
    var project = issueID.replace(/(.*)-(.*)/g, "$1");
    var id = issueID.replace(/(.*)-(.*)/g, "$2");
    return [project, id]
}

exports.toString = toString;
exports.splitID = splitID;