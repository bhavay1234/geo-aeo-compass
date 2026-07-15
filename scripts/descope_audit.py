#!/usr/bin/env python3

import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
import time

URLS = [
    "https://www.softwareworld.co/ciam-software/comparison/",
    "https://www.guideflow.com/blog/ciam-software",
    "https://www.kinde.com/blog/compare/2025-customer-identity-access-management-ciam-software-top-10-options-compared/",
    "https://www.cygnet.one/feeds/blog/best-customer-identity-access-management",
    "https://www.loginradius.com/blog/identity/top-ciam-for-large-enterprises",
    "https://www.oloid.com/blog/sso-solutions",
    "https://blog.scalefusion.com/best-sso-solutions/",
    "https://www.miniorange.com/blog/top-enterprise-sso-solutions/",
    "https://workos.com/blog/enterprise-sso-providers-b2b-saas",
    "https://www.authx.com/blog/top-sso-solutions/",
    "https://www.authgear.com/post/top-10-sso-providers-in-2026-secure-convenient-and-scalable/",
    "https://inteca.com/business-insights/sso-providers/",
    "https://checkthat.ai/answers/what-are-the-best-sso-portal-solutions",
    "https://www.cloudeagle.ai/blogs/8-best-single-sign-on-tools-in-2024",
    "https://securityboulevard.com/2026/01/top-10-b2b-healthcare-saas-sso-solutions-in-2026/",
    "https://www.oloid.com/blog/best-passwordless-authentication-solutions",
    "https://www.1kosmos.com/resources/blog/best-passwordless-authentication-solutions",
    "https://guptadeepak.com/top-5-passwordless-authentication-solutions-in-2026-enterprise-and-saas-comparison/",
    "https://mojoauth.com/blog/best-passwordless-authentication-solutions",
    "https://www.manageengine.com/products/self-service-password/blog/best-passwordless-authentication-solutions-for-2026.html",
    "https://identitychallengecard.avatier.com/en/blog/best-passwordless-authentication-solutions-2026",
    "https://expertinsights.com/user-auth/the-top-passwordless-authentication-solutions",
    "https://www.infisign.ai/blog/best-passwordless-authentication-solutions",
    "https://securityboulevard.com/2025/12/15-best-passwordless-authentication-solutions-in-2026/",
    "https://secretsvault.com/blog/best-authentication-passwordless-mfa-2026",
    "https://www.miniorange.com/blog/mfa-providers/",
    "https://authx.com/blog/best-mfa-solutions/",
    "https://blog.scalefusion.com/best-multi-factor-authentication-solutions",
    "https://www.oloid.com/blog/multi-factor-authentication-solutions",
    "https://workos.com/blog/top-mfa-providers-2026",
    "https://mojoauth.com/blog/best-multi-factor-authentication-solutions",
    "https://www.manageengine.com/products/self-service-password/blog/best-multifactor-authentication-apps-for-enterprises%C2%A0in-2026.html",
    "https://inteca.com/business-insights/mfa-providers/",
    "https://www.authgear.com/post/top-open-source-mfa-solutions-for-enterprise-applications-2026/",
    "https://www.g2.com/products/amazon-cognito/competitors/alternatives",
    "https://www.gartner.com/reviews/product/amazon-cognito/alternatives",
    "https://workos.com/blog/aws-cognito-alternatives",
    "https://www.authgear.com/post/top-open-source-amazon-cognito-alternatives-in-2026-secure-self-hosted-options/"
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/138.0.0.0 Safari/537.36"
    )
}

results = []

for i, url in enumerate(URLS, start=1):
    print(f"[{i}/{len(URLS)}] {url}")

    row = {
        "url": url,
        "status": "",
        "title": "",
        "mentions_descope": "",
        "occurrences": 0,
        "snippets": "",
    }

    try:
        r = requests.get(
            url,
            headers=HEADERS,
            timeout=30,
            allow_redirects=True,
        )

        row["status"] = r.status_code

        soup = BeautifulSoup(r.text, "html.parser")

        title = soup.title.text.strip() if soup.title else ""
        row["title"] = title

        text = soup.get_text(" ", strip=True)

        matches = list(re.finditer(r"descope", text, re.IGNORECASE))

        row["mentions_descope"] = "YES" if matches else "NO"
        row["occurrences"] = len(matches)

        snippets = []

        for m in matches[:10]:
            start = max(0, m.start() - 120)
            end = min(len(text), m.end() + 120)
            snippet = text[start:end]
            snippet = re.sub(r"\s+", " ", snippet)
            snippets.append(snippet)

        row["snippets"] = "\n---\n".join(snippets)

    except Exception as e:
        row["status"] = "ERROR"
        row["mentions_descope"] = "ERROR"
        row["snippets"] = str(e)

    results.append(row)

    time.sleep(2)

df = pd.DataFrame(results)

df.to_csv("descope_audit.csv", index=False)

print("\nDone!")
print(df[["mentions_descope"]].value_counts())
print("\nSaved to descope_audit.csv")
