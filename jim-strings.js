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

exports.toString = toString;