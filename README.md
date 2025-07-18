# eegmanylabsorg - EEGManyLabs website

This tutorial was created by Aleksei Medvedev, so that the people unfamiliar with coding (at all) could perform simple actions to change the EEGManyLabs website.

# Getting Started

So, you received email that you were added to a GitHub repository. The following tutorial will use website repo as an example, but it is applicable to literally any other one.

Let's start by explaining what GitHub repo actually is and how to use it efficiently:
   1) It is a place where all the code and all the changes made to it over a certain period of time are stored.
   2) Any member of the team can access the latest common version at any moment of time.
   3) It is especially useful for avoiding merge conflicts (two people changed the same thing in different ways).

What do you do next?
   1) Clone the repository locally, to edit your code before sharing it with everyone.
        1. You will need to open your own code-editor (the author uses PyCharm (in free version has only Python as a programming language), however, Visual Studio Code (has literally everything) is highly recommended; PyCharm has a much more user-friendly interface, though).
        2. Open the folder you want to store the repo in through your code-editor.
        3. Create a new "terminal" and paste the following: "git clone https://github.com/eegmanylabs/eegmanylabs-org.git".
        4. Congratulations! Now you have the entire repository already connected to GitHub right on your computer!

# How the website works

The website is fully automated, well, almost.
The only thing you need to do, if you want to remove/add a person/replication/publication is to:
   1) Edit the following table: https://docs.google.com/spreadsheets/d/1KGqTiv7n6bUJMrr4E-Wm5r51YbG9dPNXzAaqTXYwKLY/edit?gid=1400075012#gid=1400075012
   2) Export this new version as a tsv file
   3) Replace an old version with a new one in the data folder
   4) Add pictures/pdf files to corresponding folders
   5) Preview changes locally
   6) Update the website (will be explained further (actually, you will not be updating it by yourself, just proposing changes to other people))

And while steps 1-3 are quite straightforward even for a person with negative coding background, steps 4 and 5 might need some further explanation

# Step 4 explained: adding new pictures/pdfs

Let's imagine you added a new person/publication/replication and it looks great! But... there is no picture, so we'll fix that.

### People
Place the picture into assets/images/headshots/PICTURE_NAME.jpg
Name it after PersonID

### Replications
Place the picture into assets/images/figures/PICTURE_NAME.png
Name it after StudyID

### Publications
Place the picture into assets/images/previews/PICTURE_NAME.pdf.png
Name it after PublicationID

Place the picture into assets/pdfs/PDF_NAME.pdf
Name it after PublicationID

# Step 5 explained: preview changes locally

### Setting everything up

Ensure you start in the root of the directory containing the website files on your computer (the eegmanylabs-org folder)

Create new python virtual environment

        python -m venv .venv --prompt .         # example # if "python" command does not work, try "python3"

Activate virtual environment

        .venv/Scripts/activate                  # for Windows
        source .venv/bin/activate               # for MacOS/Linux

Install ***syrinx*** and dependencies

        python -m pip install -r requirements.txt

Build the site using ***syrinx***

        syrinx . -c

Start a server to serve the site locally

        python -m http.server -d dist

Now, open any browser and go to the http://localhost:8000 page. The website should be there

After finishing previewing, just press "Ctrl/Cmd + C" (like copy) and it will stop the python webserver

### From now on

Any time you want to preview the website, you just run (within the root directory)

        syrinx . -c
        python -m http.server -d dist

And after that go to the http://localhost:8000 page.

You only need to do that if the server is not running already (you stoped it earlier)

# Step 6 explained: update the website

As it was already said above, you can't really update the website by yourself, however, you can share your new code with the people, who can (ultimately, that is what GitHub is for)

So, you changed the website locally, and you are comfortable with the preview, now you need to push these changes to GitHub (PyCharm has a very simple intuitive interface, and you might not need to go through all these steps, but if you are using VSCode or if you are still willing to go this way, while using PyCharm, here it is), type into the terminal in your code-editor the following list of commands:

        git checkout -b BRANCH_NAME                     # create a branch (a copy of the main code on GitHub with your changes in it)
                                                        # usually a branch is named by the thing you fix (e.g. add_replic_Granger2009)
        git add PATH_TO_EDITED_FILES_OR_DIRECTORIES     # see below
        git commit -m "MESSAGE"                         # commit changes and asign a message to them
        git push -u origin BRANCH_NAME                  # push changes to the branch

***Git add***: after this command you should write paths to specific files or entire directories you changed and would like to push to GitHub.
For example: you added a new Publication, to add everything you need to write the following:

        git add data/publications.tsv assets/pdfs/ assets/images/previews/   # updates a tsv and two directories

After all these steps you should go to the GitHub website and create a "pull request" (there will be a button with this name) for a specific branch you created. After writing a description for pull request you will be given information if any merge conflicts occurred. If not, you leave it like this (if yes, you can have a look at them, however, what you need to do afterwards really depends on the situation). Don't merge a pull request yourself!!! Let others take a look at it first.

### From now on

If that is going to be your second (or third, or fourth...) time of adjusting the website, you should run the following code before changing anything. That will make sure that you have the latest version (in case someone updated it since the last time):

        git pull origin master

Thank you for reading this quick material, hope it was helpful)))
