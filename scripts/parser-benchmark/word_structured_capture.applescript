use framework "Foundation"
use scripting additions

property formattingDeadline : missing value

on newObject()
    return current application's NSMutableDictionary's dictionary()
end newObject

on newArray()
    return current application's NSMutableArray's array()
end newArray

on paragraphBreakCount(theText)
    set previousDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to return
    set breakCount to (count text items of theText) - 1
    set AppleScript's text item delimiters to previousDelimiters
    return breakCount
end paragraphBreakCount

on styledTail(theDocument, styleName, firstPosition, lastPosition)
    if formattingDeadline is not missing value and (current date) > formattingDeadline then error "Resolved formatting time budget exceeded"
    if lastPosition ≤ firstPosition then return {}
    tell application "Microsoft Word"
        set r to create range theDocument start firstPosition end lastPosition
        if styleName is "bold" then
            set flag to bold of r
        else
            set flag to italic of r
        end if
        if flag is false then return {}
        if flag is true then
            set spanText to content of r
            set prefixRange to create range theDocument start 0 end firstPosition
            return {{spanText, content of prefixRange, firstPosition, lastPosition}}
        end if
    end tell
    if lastPosition - firstPosition ≤ 1 then error "Unresolved character formatting"
    set midpoint to firstPosition + ((lastPosition - firstPosition) div 2)
    return my styledTail(theDocument, styleName, firstPosition, midpoint) & my styledTail(theDocument, styleName, midpoint, lastPosition)
end styledTail

on styledSpans(theDocument, styleName)
    if formattingDeadline is not missing value and (current date) > formattingDeadline then error "Resolved formatting time budget exceeded"
    tell application "Microsoft Word"
        set bodyRange to text object of theDocument
        set lastPosition to end of content of bodyRange
        if styleName is "bold" then
            set wholeStyle to bold of bodyRange
        else
            set wholeStyle to italic of bodyRange
        end if
        if wholeStyle is not missing value then return my styledTail(theDocument, styleName, 0, lastPosition)
        select bodyRange
        set f to find object of selection
        clear formatting f
        if styleName is "bold" then
            set bold of font object of f to true
        else
            set italic of font object of f to true
        end if
        set spans to {}
        set previousEnd to 0
        repeat 100000 times
            if formattingDeadline is not missing value and (current date) > formattingDeadline then error "Resolved formatting time budget exceeded"
            set hit to execute find f find text "" find format true match forward true wrap find find stop replace replace none match case false match whole word false match wildcards false match sounds like false match all word forms false
            if hit is false or (found of f) is false then return spans & my styledTail(theDocument, styleName, previousEnd, lastPosition)
            set firstPosition to selection start of selection
            set finalPosition to selection end of selection
            set selectedStory to (story type of text object of selection) as string
            if selectedStory is not "main text story" or firstPosition < previousEnd or finalPosition ≤ firstPosition or finalPosition > lastPosition then return spans & my styledTail(theDocument, styleName, previousEnd, lastPosition)
            set spans to spans & my styledTail(theDocument, styleName, previousEnd, firstPosition) & my styledTail(theDocument, styleName, firstPosition, finalPosition)
            set previousEnd to finalPosition
            if finalPosition ≥ lastPosition then return spans
            select (create range theDocument start finalPosition end finalPosition)
            set f to find object of selection
        end repeat
    end tell
    error "Formatted range limit exceeded"
end styledSpans

on run argv
    set output to current application's NSMutableDictionary's dictionary()
    set failures to current application's NSMutableDictionary's dictionary()
    set openedDocument to missing value
    set captureStage to "opening"
    with timeout of 60 seconds
    tell application "Microsoft Word"
        set priorSecurity to automation security
        set priorAlerts to display alerts
        set priorLinks to update links at open of settings
        set automation security to msoAutomationSecurityForceDisable
        set display alerts to alerts none
        set update links at open of settings to false
        try
            open file name (item 1 of argv) read only true add to recent files false confirm conversions false
            set documentName to name of active document
            set openedDocument to document documentName
            set captureStage to "identity"
            if posix full name of openedDocument is not item 1 of argv then error "Opened document identity mismatch"
            set revisionCount to count revisions of openedDocument
            if revisionCount > 0 then accept all revisions openedDocument
            output's setObject:revisionCount forKey:"accepted_revisions"
            output's setObject:version forKey:"word_version"
            set bodyRange to text object of openedDocument
            set captureStage to "body"
            output's setObject:((include field codes of text retrieval mode of bodyRange) as string) forKey:"include_field_codes"
            output's setObject:((include hidden text of text retrieval mode of bodyRange) as string) forKey:"include_hidden_text"
            set bodyText to content of bodyRange
            set paragraphCount to count paragraphs of openedDocument
            output's setObject:bodyText forKey:"body_text"
            output's setObject:paragraphCount forKey:"reported_paragraph_count"
            if my paragraphBreakCount(bodyText) is not paragraphCount then
                set paragraphTexts to my newArray()
                repeat with pi from 1 to paragraphCount
                    paragraphTexts's addObject:(content of text object of paragraph pi of openedDocument)
                end repeat
                output's setObject:paragraphTexts forKey:"paragraph_texts"
            end if
            set captureStage to "resolved_formatting"
            try
                set formattingDeadline to missing value
                if (count argv) ≥ 3 then
                    set budget to (item 3 of argv) as integer
                    if budget > 0 then set formattingDeadline to (current date) + budget
                end if
                set formatting to my newObject()
                formatting's setObject:(my styledSpans(openedDocument, "bold")) forKey:"bold"
                formatting's setObject:(my styledSpans(openedDocument, "italic")) forKey:"italic"
                output's setObject:formatting forKey:"formatted_spans"
            on error errorText number errorNumber
                failures's setObject:(errorNumber & ": " & errorText) forKey:"resolved_formatting"
            end try
            set captureStage to "tables"
            try
                set tableData to my newArray()
                repeat with ti from 1 to count tables of bodyRange
                    set tr to text object of table ti of bodyRange
                    set t to my newObject()
                    t's setObject:(content of tr) forKey:"text"
                    t's setObject:(nesting level of table ti of bodyRange) forKey:"nesting_level"
                    tableData's addObject:t
                end repeat
                output's setObject:tableData forKey:"tables"
            on error errorText number errorNumber
                failures's setObject:errorNumber forKey:"tables"
            end try
            try
                set captureStage to "hyperlinks"
                set links to {}
                repeat with hi from 1 to count hyperlink objects of openedDocument
                    set hr to text object of hyperlink object hi of openedDocument
                    if (story type of hr) as string is "main text story" then
                        set end of links to {content of hr, start of content of hr, end of content of hr, hyperlink address of hyperlink object hi of openedDocument, sub address of hyperlink object hi of openedDocument}
                    end if
                end repeat
                output's setObject:links forKey:"hyperlinks"
            on error errorText number errorNumber
                failures's setObject:errorNumber forKey:"hyperlinks"
            end try
            try
                set captureStage to "objects"
                output's setObject:(count inline shapes of openedDocument) forKey:"inline_shape_count"
                output's setObject:(count shapes of openedDocument) forKey:"floating_shape_count"
                output's setObject:(count math objects of openedDocument) forKey:"equation_count"
            on error errorText number errorNumber
                failures's setObject:errorNumber forKey:"objects"
            end try
            set captureStage to "save_flat_opc"
            save as openedDocument file name (item 2 of argv) file format format flat document add to recent files false
            output's setObject:"ok" forKey:"status"
        on error errorText number errorNumber
            output's setObject:"error" forKey:"status"
            output's setObject:errorNumber forKey:"error_code"
            output's setObject:errorText forKey:"error"
            output's setObject:captureStage forKey:"error_stage"
        end try
        try
            repeat with di from (count documents) to 1 by -1
                set documentPath to posix full name of document di
                if documentPath is item 1 of argv or documentPath is item 2 of argv then close document di saving do not save changes
            end repeat
        on error errorText number errorNumber
            failures's setObject:errorNumber forKey:"close"
        end try
        set automation security to priorSecurity
        set display alerts to priorAlerts
        set update links at open of settings to priorLinks
    end tell
    end timeout
    output's setObject:failures forKey:"unavailable"
    set encoded to current application's NSJSONSerialization's dataWithJSONObject:output options:0 |error|:(missing value)
    if encoded is missing value then error "Structured export cannot be encoded"
    return (current application's NSString's alloc()'s initWithData:encoded encoding:(current application's NSUTF8StringEncoding)) as text
end run
