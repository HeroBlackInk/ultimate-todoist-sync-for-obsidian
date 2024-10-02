## Step 1: Download the plugin

In this step, you'll download a ultimate-todoist-sync-for-obsidian plugin to the `plugins` directory in your vault's [`.obsidian` directory](https://help.obsidian.md/Advanced+topics/How+Obsidian+stores+data#Per+vault+data) so that Obsidian can find it.

The ultimate-todoist-sync-for-obsidian plugin you'll use in this tutorial is available in a [GitHub repository](https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian.git).

1.  Open a terminal window and change the project directory to the `plugins` directory.
    
    ```bash
    cd path/to/vault mkdir .obsidian/plugins cd .obsidian/plugins
    ```
    
2.  Clone the ultimate-todoist-sync-for-obsidian plugin using Git.
    
    ```bash
    git clone https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian.git
    ```
    

GitHub template repository

The repository for the ultimate-todoist-sync-for-obsidian plugin is a GitHub template repository, which means you can create your own repository from the ultimate-todoist-sync-for-obsidian plugin. To learn how, refer to [Creating a repository from a template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template#creating-a-repository-from-a-template).

Remember to use the URL of your own repository when cloning the ultimate-todoist-sync-for-obsidian plugin.

## Step 2: Build the plugin

In this step, you'll compile the ultimate-todoist-sync-for-obsidian plugin so that Obsidian can load it.

1.  Navigate to the plugin directory.
    
    ```bash
    cd ultimate-todoist-sync-for-obsidian
    ```
    
2.  Install dependencies.
    
    ```bash
    npm install
    ```
    
3.  Compile the source code. The following command keeps running in the terminal and rebuilds the plugin when you modify the source code.
    
    ```bash
    npm run dev
    ```
    

Notice that the plugin directory now has a `main.js` file that contains a compiled version of the plugin.

## Step 3: Enable the plugin

To load a plugin in Obsidian, you first need to enable it.

1.  In Obsidian, open **Settings**.
2.  In the side menu, select **Community plugins**.
3.  Select **Turn on community plugins**.
4.  Under **Installed plugins**, enable the **ultimate-todoist-sync-for-obsidian plugin** by selecting the toggle button next to it.

You're now ready to use the plugin in Obsidian. Next, we'll make some changes to the plugin.