/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './src/renderer/**/*.{js,ts,jsx,tsx,html}'
    ],
    theme: {
        extend: {
            colors: {
                'de': {
                    'primary': '#0066ff',
                    'primary-hover': '#0055dd',
                    'success': '#2ecc71',
                    'warning': '#f39c12',
                    'error': '#e74c3c',
                    'bg': {
                        DEFAULT: '#0d0d14',
                        'light': '#1a1a24',
                        'card': '#12121a'
                    },
                    'border': '#2a2a3a',
                    'text': {
                        DEFAULT: '#e0e0e0',
                        'secondary': '#8a8a9a'
                    }
                }
            },
            fontFamily: {
                'display': ['Space Grotesk', 'system-ui', 'sans-serif'],
                'body': ['Inter', 'system-ui', 'sans-serif'],
                'mono': ['JetBrains Mono', 'monospace']
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow': 'glow 2s ease-in-out infinite alternate'
            },
            keyframes: {
                glow: {
                    '0%': { boxShadow: '0 0 5px rgba(0, 102, 255, 0.5)' },
                    '100%': { boxShadow: '0 0 20px rgba(0, 102, 255, 0.8)' }
                }
            }
        }
    },
    plugins: []
};
