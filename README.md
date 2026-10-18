# 그래픽 스타일 컬렉션

포스터 181종, 모션 디자인 정지 스타일 프레임 5종, 컴포지션 15종을 탐색하는 정적 웹사이트입니다. 메인 화면에서 **포스터 디자인 → 모션 디자인 → 컴포지션** 세 탭으로 전환합니다. 전체 201종이며, 이미지 다운로드는 모션 컬렉션에서만 지원합니다.

모든 포스터에는 25개 공통 키워드 중 3~5개 태그가 표시됩니다. 카드 태그나 목록 위의 **키워드로 찾기**에서 여러 태그를 선택하면, 선택한 키워드를 모두 포함하는 포스터만 최신순으로 볼 수 있습니다. 상세 보기의 이전·다음도 필터 결과 안에서 이동합니다.

컴포지션에서는 황금비, 삼분할, 유도선, 대각선, 대칭, 프레임 속 프레임, 병치, 소실점, 중앙 배치 등을 사진 예시와 구도선으로 비교합니다. 상세의 **구도선 보기** 버튼으로 가이드를 켜고 끌 수 있습니다. 같은 원리도 장면이 다르면 별도 예시로 유지합니다.

UI 변경과 컬렉션 추가 규칙, 경로/파일 맵, 추가 양식은 [컬렉션 구성 가이드](docs/collections.md)를 따릅니다. 작업 범위와 배포 원칙은 [AGENTS.md](AGENTS.md)에 있습니다.

## 애니메이션 스타일의 포스터 전환

기존 애니메이션 20개 스타일은 모두 새 그래픽 포스터 90~109번으로 옮겼습니다. 같은 스타일이 이미 있어도 기존 예시를 유지하고 다른 레이아웃으로 추가합니다. 애니메이션 탭과 실시간 렌더러는 제거했으며, 기존 `#animation/01`이나 `animation.html#01` 주소는 대응하는 포스터 상세 보기로 연결됩니다. 항목별 이동 맵은 [컬렉션 구성 가이드](docs/collections.md)에 있습니다.

`#posters/181`, `#motion/5`, `#composition/15`처럼 번호로 상세 보기를 바로 열 수 있습니다. 모든 예시는 정지 이미지이며 외부 3D 라이브러리를 불러오지 않습니다.

## 로컬 실행

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

브라우저에서 <http://127.0.0.1:8000>을 엽니다. 별도 의존성 설치나 빌드가 필요하지 않습니다.

구조 검증: `node scripts/check-collections.mjs`. UI 변경 후에는 세 탭과 상세 보기, 키보드 이동, 직접 링크, 모바일 화면도 확인합니다.

## 태그로 배포

[Deploy GitHub Pages](https://github.com/tomlim2/llm-design-reference/actions/workflows/deploy.yml) 워크플로우는 `v`로 시작하는 태그를 푸시하면 해당 커밋을 GitHub Pages에 배포합니다. 브랜치 푸시와 태그 삭제는 배포하지 않습니다.

기본 작업은 커밋·푸시까지이며, 배포는 별도로 요청받은 경우에만 아래 명령을 사용합니다.

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

워크플로우는 태그의 HTML, 공통 CSS, JavaScript 모듈, 이미지, JSON, 모션 ZIP을 묶어 배포합니다. 포스터 ZIP은 배포하지 않습니다. GitHub에서 제공하는 토큰을 사용하므로 별도 배포 시크릿은 필요하지 않습니다.
