module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": [
        "plugin:@typescript-eslint/recommended"
    ],
    "overrides": [
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "rules": {
      "indent": ["error", 2, { "SwitchCase": 1 }],
      "no-trailing-spaces": "error",
      "eol-last": "error",
      "quotes": [2, "single", { "avoidEscape": true }],
      "brace-style": ["error", "1tbs"],
      "eqeqeq": [
        "error",
        "smart"
      ],
      "prefer-rest-params": "off",
      "no-console": "error",
      "no-shadow": "off",
      "arrow-parens": ["error", "as-needed"],
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/no-this-alias": "off",
    }
}
