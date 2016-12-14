# Introduction

This node.js-based tool will help java.net Project Administrators migrate entire project 
issues databases, including all historically created issues and those currently managed by 
the java.net JIRA servers into equivalent GitHub issues.   After inspecting a specified
java.net project, this tool will automatically; 

1. Create GitHub Labels for each JIRA Component Names, Priorities, Issue Types and Resolutions used by a project,
2. Create GitHub Milestones for each JIRA Versions used by a project,
3. Create an equivalent GitHub Issue for each JIRA Issue in a project, ensuring;
a). Issue numbers are equivalent between GitHub and JIRA (so they can easily be cross referenced)
b). Current issue status is maintained (open issues are left open, closed issues are closed)
c). Each issue is assigned to an identifiable GitHub contributor (if found)
d). All JIRA-based code samples are converted into appropriate markdown format (so they are correctly displayed)
e). Issue comment history is faithfully recreated (including markdown reformatting where appropriate)

To use this tool you'll need:

1. The JIRA project key for the java.net project you'd like to migrate.  eg: COHSPR
2. The target GitHub repository into which you'd like to migrate issues.  Usually this will be a new and clean repository.
3. Your GitHub username, typically the owner of the target GitHub repository.
4. Your GitHub personal token (for authentication purposes).

With this information the tool will perform the migration on your behalf.

# Build Instructions

From the base folder:

```
    npm install
```

# Running locally

Use the following from the command line to start in continuous development (auto-refresh) and debugging mode:

(assuming nodemon is installed)

```
    DEBUG=jim:* nodemon start.js
```    

Or just to run locally use:

(using npm)

```
    npm start
```

Then navigate to:  `http://localhost:3000/`

# Running in Docker

From the root folder run:

```
    docker build -t jim:1.0 .
```

This will build an image called ```jim:1.0``` which can be run with a normal Docker run command
that should explicitly expose port 3000 or expose all ports with the -P option, for example:

```
    docker run -d -P --name jim jim:1.0
```

You should then be able to navigate to `http:<docker-host>:<port>` where `<docker-host>` is the host name of the Docker 
host and `<port>` is the port that Docker has NAT'ed to port 3000 in the container.  