/**
 * Copyright 2025 RAIDS Lab
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Ref, SVGProps, forwardRef } from 'react'

const SvgComponent = (props: SVGProps<SVGSVGElement>, ref: Ref<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 230 72" ref={ref} {...props}>
    <text
      x="0"
      y="55"
      fill="currentColor"
      fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
      fontSize="56"
      fontWeight="800"
      letterSpacing="0"
    >
      ORBIT
    </text>
  </svg>
)
const OrbitTextIcon = forwardRef(SvgComponent)
OrbitTextIcon.displayName = 'OrbitTextIcon'
export default OrbitTextIcon
