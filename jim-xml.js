/**
 * Extract the value of each child with the given elementName from the specified xml element
 * and places the value into the provided container.
 *
 * @param xmlFromElement  the xml element defining the child elements
 * @param elementName     the name of the child elements from which to extract values
 * @param into            the container (Array or Set) in which to add the extracted child values
 */
function childValuesFrom(xmlFromElement, elementName, into, prefix="")
{
    var xmlElements = xmlFromElement.childrenNamed(elementName);

    if (xmlElements)
    {
        xmlElements.forEach(function(xmlElement)
        {
            if (into instanceof Set) {
                into.add(prefix + xmlElement.val);
            } else if (into instanceof Array) {
                into.push(prefix + xmlElement.val);
            }
        });
    }
}

exports.childValuesFrom = childValuesFrom;