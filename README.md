# ai-digital-picture-frame

This Node.js repository contains an Azure function to generate images via Open AI / DALL-E and upload them to a digital picture frame in my home.

The code contains URLs to my Azure resources. You would need to fork the repository and change the URLs to use it in your own projects.

# Run

In VS Code, Run `Connect-AzAccount` in Terminal. Then Start Debugging from the Run menu.

You will need to adjust the function schedule so that the function will execute when debugging.

# Publish

Run `func azure functionapp publish function7492` in Terminal. This requires Azure Functions Core Tools to be installed on the local machine.