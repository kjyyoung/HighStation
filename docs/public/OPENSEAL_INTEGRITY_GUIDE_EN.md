# 🔏 OpenSeal Code Integrity Guide

The most powerful way to increase trust for your service in the HighStation ecosystem is to prove its code integrity via **OpenSeal**. Verified services receive higher search rankings and a "Security Premium" trust score.

## 🏗️ 3-Step Integration Process

### 1. Wrapping as an API Server
Wrap your core logic into a HighStation-compatible API server to prepare for gateway communication.

- **Port Config**: Your internal server typically listens on port `3000` or a custom port.
- **Standard Response**: Implement endpoints that process agent requests and return JSON results.
- **Security**: Refer to the [Provider Guide](./PROVIDER_GUIDE_EN.md) to implement IP Whitelisting and HMAC Signature Verification.

### 2. OpenSeal SDK Integration (Opensealing)
Integrate the OpenSeal SDK into your codebase and generate an integrity hash (Merkle Root).

- **SDK Install**:
  ```bash
  npm install @highstation/openseal-sdk
  ```
- **Build Hash**: Use `openseal-cli` to perform a build in the project root.
  ```bash
  openseal build
  ```
- **Output**: An `openseal.json` file will be generated in your project root, containing cryptographic fingerprints of all source files.

### 3. Tagging & Push
Commit your code along with the generated integrity proof to GitHub.

- **Add Tag**: Insert the OpenSeal Verification Badge at the top of your `README.md` to demonstrate transparency.
  - **Markdown Example**:
    ```markdown
    [![OpenSeal Verified](https://img.shields.io/badge/OpenSeal-Verified-success?style=for-the-badge&logo=security)](https://highstation.io/verify/your-repo-address)
    ```
- **Push & Tagging**: Include the `openseal.json` file in your repository and create a Git tag **starting with `openseal`**. (The HighStation verification engine looks for this specific prefix to confirm integrity.)
  ```bash
  git add openseal.json README.md
  git commit -m "chore: implement OpenSeal code integrity proof"
  git push origin main

  # Create GitHub Tag (Must start with 'openseal')
  git tag -a openseal-v1.0.0 -m "Release v1.0.0 with OpenSeal Integrity Proof"
  git push origin openseal-v1.0.0
  ```
- **Registration**: Link your GitHub repo's specific tag URL (e.g., `.../releases/tag/openseal-v1.0.0`) in the HighStation Dashboard.

---

## 🏆 Benefits of Verification
- **L1 Integrity Guarantee**: Mathematically proves the running code matches the public source 100%.
- **Trust Score Boost**: Gain the `openseal_verified: true` flag.
- **Increased Agent Adoption**: Security-conscious enterprise agents are configured to prioritize OpenSeal-verified services.
