const fs = require('fs');
const path = require('path');

const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
const version = require(path.join(process.cwd(), 'package.json')).version;

try {
  const content = fs.readFileSync(changelogPath, 'utf8');
  
  // Regex to match the current version section
  // Matches: ## [x.x.x] - date ... content ... until next ## [x.x.x] or eof
  const regex = new RegExp(`## \\[${version}\\] - \\d{4}-\\d{2}-\\d{2}([\\s\\S]*?)(?=## \\[|$)`, 'i');
  
  const match = content.match(regex);
  
  if (match && match[1]) {
    // Trim and clean up
    console.log(match[1].trim());
  } else {
    console.error(`Could not find release notes for version ${version}`);
    process.exit(1);
  }
} catch (err) {
  console.error('Error reading changelog:', err);
  process.exit(1);
}
