# Introduction

This node.js-based tool will help java.net Project Administrators migrate entire project 
issues databases, including all historically created issues and those currently managed by 
the java.net JIRA servers into equivalent GitHub issues.   After inspecting a specified
java.net project, this tool will automatically; 

1. Create GitHub Labels for each JIRA Component Names, Priorities, Issue Types and Resolutions used by a project,
2. Create GitHub Milestones for each JIRA Versions used by a project,
3. Create an equivalent GitHub Issue for each JIRA Issue in a project, ensuring;

a). Issue numbers are equivalent between GitHub and JIRA (so they can easily be cross referenced). In case this is not possible, we introduce a constant offset(Look at https://github.com/brianoliver/jim/issues/21 for more details)

b). Current issue status is maintained (open issues are left open, closed issues are closed)

c). Each issue is assigned to an identifiable GitHub contributor (if found in the mapping.txt file)

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
  
For a demo of running Jim on the Google Cloud Platform using Kubernetes see the [googlecloud](googlecloud/README.md) folder. 

# Usage Instructions
Here is a general flow of what you might want to do to migrate a project: 
1. Create a file named `mapping.txt` in the base folder. It should contain the java.net user names to Github user names mapping of users

E.g.,
```
abc abc
def def
```

2. Import collaborators into Github: On the localhost page(`http://localhost:3000/`), you will see an option to import collaborators. This needs to be done before the migration of a project in order to be able to assign issues correctly. As mentioned [here](https://help.github.com/articles/assigning-issues-and-pull-requests-to-other-github-users/), users need to be added as collaborators before we can assign them to an issue. Specify the required options to add all the Github users in the mapping file(`mapping.txt`) as collaborators(with read access) for this repository

3. Create a folder named `json`. The json dump will be generated and placed in this folder. If the project name is `glassfish`, a json file named `GLASSFISH.json` would be generated in this folder. Note that JIM will check for an existing file named `{project}.json` before downloading the issues from JIRA. In case it is found, JIM will read the JSON file instead of downloading the issues. This feature helps to stop and re-start the migration quickly if needed

4. After choosing the source project from drop-down list, you will have to specify the following options before starting the migration:

     a. Repository name: Name of the destination repository (E.g., `glassfish`)
     
     b. Repository Owner: If the repository is owned by an organization, specify the organization name (E.g., `javaee`). Otherwise, specify the name of the repository owner
     
     c. Default Issue Owner: For issues with unknown assignees(because the assignee's Github username is not present in the mapping file), JIM assign issues to this user. Enter a valid Github user name in this field. Leave this field empty to leave such issues unassigned
     
     d. Issue Offset: If the destination repository already has some Pull Requests or Issues(Look at https://github.com/brianoliver/jim/issues/21), specify the offset here. Normally, this should be set to zero
     
     e. API Token: Specify the API token of the user here. Ensure that the user who has generated this has enough rights over the repository
    
Note: If the destination repository is not inside an organization, you will need the personal token of repository owner to create issues
