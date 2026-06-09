const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runCommand(command, cwd) {
    console.log(`Running: ${command} in ${cwd || 'root'}`);
    execSync(command, { stdio: 'inherit', cwd });
}

try {
    // 1. Clean previous build
    if (fs.existsSync(path.join(__dirname, 'dist'))) {
        fs.rmSync(path.join(__dirname, 'dist'), { recursive: true, force: true });
    }

    // 2. Build root app (Management)
    runCommand('npx ui5 build --config=ui5.yaml --clean-dest --dest dist');

    // 3. Build Dashboard app
    runCommand('npx ui5 build --config=ui5.yaml --clean-dest --dest dist', path.join(__dirname, 'apps', 'dashboard'));
    console.log('Copying dashboard build output to dist/dashboard...');
    fs.mkdirSync(path.join(__dirname, 'dist', 'dashboard'), { recursive: true });
    fs.cpSync(
        path.join(__dirname, 'apps', 'dashboard', 'dist'), 
        path.join(__dirname, 'dist', 'dashboard'), 
        { recursive: true }
    );

    // 4. Build Analytic app
    runCommand('npx ui5 build --config=ui5.yaml --clean-dest --dest dist', path.join(__dirname, 'apps', 'analytic'));
    console.log('Copying analytic build output to dist/analytic...');
    fs.mkdirSync(path.join(__dirname, 'dist', 'analytic'), { recursive: true });
    fs.cpSync(
        path.join(__dirname, 'apps', 'analytic', 'dist'), 
        path.join(__dirname, 'dist', 'analytic'), 
        { recursive: true }
    );

    console.log('Unified Fiori Monorepo Build Completed Successfully!');
} catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
}
