cat > node_modules/react-native/Libraries/Utilities/Platform.js <<'EOF'
'use strict';

// Web bundling fallback when Platform.js is missing.
// Use iOS implementation as the default.
module.exports = require('./Platform.ios');
EOF