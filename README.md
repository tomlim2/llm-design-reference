# 디자인 스타일 컬렉션

AI로 생성한 포스터 80종과 모션 디자인 스타일 프레임 5종을 탐색하는 정적 웹사이트입니다. 이미지 확대와 생성 프롬프트를 제공하며, 이미지 다운로드는 모션 컬렉션에서만 지원합니다.

## 3D 애니메이션 스타일

`animation.html`은 Three.js(r160, jsDelivr CDN)로 브라우저에서 실시간 렌더링하는 3D 애니메이션 스타일 20종입니다. 카드 격자에서 살아 움직이는 미리보기를 보고, 카드를 열면 큰 화면과 Claude에게 줄 프롬프트가 나옵니다. 장면은 `animation-styles.mjs`에 스타일마다 하나씩 들어 있고, `animation.mjs`가 렌더러 하나로 미리보기와 뷰어를 돌립니다. 인터넷 연결과 WebGL 2가 필요합니다.

## 로컬 실행

```sh
python3 -m http.server 8000
```

브라우저에서 <http://localhost:8000>을 엽니다. 별도 의존성 설치나 빌드가 필요하지 않습니다.

## 태그로 배포

[Deploy GitHub Pages](https://github.com/tomlim2/llm-design-reference/actions/workflows/deploy.yml) 워크플로우는 `v`로 시작하는 태그를 푸시하면 해당 커밋을 GitHub Pages에 배포합니다. 브랜치 푸시와 태그 삭제는 배포하지 않습니다.

```sh
git switch main
git pull --ff-only
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

다음 배포에는 `v1.0.1`처럼 새 버전 태그를 사용하세요. 기존 태그를 이동하거나 덮어쓰지 않습니다. 이전 버전으로 되돌릴 때도 원하는 커밋에 새 태그를 붙여 배포할 수 있습니다.

최초 설정:

1. 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.
2. **Settings → Environments → github-pages → Deployment branches and tags**에서 **Selected branches and tags**를 선택하고, **Tag** 규칙으로 `v*`를 허용합니다.
3. GitHub Free 계정에서는 저장소가 공개되어 있어야 Pages를 사용할 수 있습니다. 비공개 저장소의 Pages에는 지원되는 유료 요금제가 필요합니다. [GitHub 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

배포 주소: <https://tomlim2.github.io/llm-design-reference/>

워크플로우는 태그의 HTML, JavaScript, 이미지, JSON, 모션 ZIP만 묶어 배포합니다. 포스터 ZIP은 배포하지 않습니다. GitHub에서 제공하는 토큰을 사용하므로 별도 배포 시크릿은 필요하지 않습니다.
