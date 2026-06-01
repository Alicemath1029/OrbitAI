---
title: DeepSeek R1 단일 머신 추론의 빠른 배포
description: 이 플랫폼은 DeepSeek R1 단일 머신 추론을 빠르게 배포할 수 있는 작업 템플릿을 제공합니다. 이 템플릿을 사용하여 직접 단일 머신 작업을 생성하고, 자신만의 DeepSeek 를 빠르게 배포하거나 웹 UI 인터페이스를 시작하여 대규모 모델과 상호작용할 수 있습니다.
---

# DeepSeek R1 단일 머신 추론의 빠른 배포

**작업 템플릿** 섹션에서는 **DeepSeek R1 단일 머신 추론** 작업 템플릿을 제공합니다. 이 템플릿을 직접 선택하여 DeepSeek R1 단일 머신 추론을 빠르게 배포할 수 있으며, 웹 UI 인터페이스를 시작하여 대규모 모델과 상호작용할 수도 있습니다.

## 템플릿 선택으로 작업 생성

사이드바의 작업 템플릿을 클릭한 후 **DeepSeek R1 단일 머신 추론** 템플릿을 선택합니다.

![](./img/sin-deepseek-7b/sin-temp.webp)

선택 후 새 사용자 정의 작업 생성 화면으로 이동하게 되며, 관련 템플릿 파라미터가 이미 완료되어 있습니다:

![](./img/sin-deepseek-7b/sin-submit.webp)

## 시작 명령어 설명

템플릿의 시작 명령어는 다음과 같습니다:

```bash
vllm serve ./deepseek-r1-7b --dtype=half --enable-chunked-prefill=False --max-model-len=8192
```

각 파라미터의 설명은 다음과 같습니다:

- ./deepseek-r1-7b

  - 사용할 모델의 경로를 지정합니다. 현재 작업 디렉터리의 deepseek-r1-7b 폴더에는 모델의 가중치 파일, 구성 파일 등의 필수 정보가 포함되어 있습니다 (주피터 작업을 시작할 때 마운트되며, 사용자가 지정한 모델 경로로도 변경할 수 있음)

- --dtype=half

  - 모델 파라미터의 데이터 타입을 반정밀도 부동소수점 (float16) 으로 지정합니다.

- --enable-chunked-prefill=False

  - 청크화된 예비 입력 기능을 비활성화합니다.

- --max-model-len=8192

  - 모델이 처리할 수 있는 최대 입력 길이를 8192 개의 토큰 (tokens) 으로 지정합니다.

> 후속 세 개의 파라미터는 **요청한 GPU 유형에 따라 사용자가 직접 조정할 수 있습니다**. 이 경우 **V100 에서 정상적으로 실행되도록 보장하기 위해 vLLM 의 일부 기능이 비활성화되었습니다**.
> vLLM serve 시 지정할 수 있는 전체 파라미터의 설명은 [Engine Arguments](https://docs.vllm.ai/en/latest/serving/engine_args.html)를 참조하십시오.

## 작업 성공 실행

작업을 제출한 후 작업 실행을 기다린 후, 작업 상세 페이지에 들어가 기본 정보 탭에서 실시간 출력을 확인할 수 있습니다. 모델이 성공적으로 실행되었음을 확인할 수 있습니다.

![](./img/sin-deepseek-7b/sin-detail.webp)

웹 터미널을 클릭하여 curl 명령어를 사용하여 해당 서비스에 요청을 보내 볼 수 있습니다. 예시는 다음과 같습니다:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
  "model": "./deepseek-r1-7b",
  "messages": [
    {"role": "user", "content": "인공지능에서의 딥러닝과 머신러닝의 차이점은 무엇인가요?"}
  ]
}'
```

이제, 작업 템플릿을 사용하여 빠르게 배포한 DeepSeek R1 7b 모델과 대화를 시작할 수 있습니다 🥳!

## 웹 UI 인터페이스 시작 및 대규모 모델과의 상호작용

**Open WebUI 클라이언트 템플릿**은 모델 배포 유형의 템플릿과 함께 사용되어, 대규모 모델을 쉽게 시도할 수 있는 친화적인 경험을 제공합니다.

사이드바의 작업 템플릿을 클릭한 후 **Open WebUI 클라이언트** 템플릿을 선택합니다.

![](./img/sin-deepseek-7b/openweb-temp.webp)

선택 후 새 사용자 정의 작업 생성 화면으로 이동하게 되며, 관련 템플릿 파라미터가 이미 완료되어 있습니다:

![](./img/sin-deepseek-7b/openweb-submit.webp)

**DeepSeek R1 단일 머신 추론** 작업 템플릿을 사용하여 Orbit 플랫폼에서 대규모 모델 추론 서비스를 시작한 후, 환경 변수의 첫 줄을 수정하여 OpenAI 서비스 주소를 설정해야 합니다.

단일 머신에서 모델을 배포한 경우, 작업의 **「기본 정보」섹션의「내부 IP」**에 해당합니다.

![](./img/sin-deepseek-7b/sin-ip.webp)

Open WebUI 가 성공적으로 시작되면, 상세 페이지에서「외부 액세스」를 클릭하여, 우리가 이미 포워딩 설정을 해두었으므로 클릭만으로 접근할 수 있습니다.

![](./img/sin-deepseek-7b/openweb-fw.webp)

대규모 모델의 여정을 즐기기 시작하세요 🥳!