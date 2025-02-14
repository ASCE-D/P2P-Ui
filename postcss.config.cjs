// postcss.config.js
module.exports = {  // Use module.exports for compatibility
    plugins: [
        require('@tailwindcss/postcss'), // Use this instead of 'tailwindcss'
        require('autoprefixer'), // Autoprefixer usually comes AFTER Tailwind
    ],
};