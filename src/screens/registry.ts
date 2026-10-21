import type { Component } from 'vue'
import type { ScreenName } from '../stores/nav'
import WelcomeScreen from './WelcomeScreen.vue'
import ConnectingScreen from './ConnectingScreen.vue'
import BrowserScreen from './BrowserScreen.vue'
import ErrorScreen from './ErrorScreen.vue'
import HomeScreen from './HomeScreen.vue'
import HomeEmptyScreen from './HomeEmptyScreen.vue'
import KickbacksScreen from './KickbacksScreen.vue'
import PlanScreen from './PlanScreen.vue'
import PoolScreen from './PoolScreen.vue'
import PoolsScreen from './PoolsScreen.vue'
import StakeScreen from './StakeScreen.vue'
import ApproveScreen from './ApproveScreen.vue'
import SuccessScreen from './SuccessScreen.vue'
import RunScreen from './RunScreen.vue'

export const SCREEN_COMPONENTS: Record<ScreenName, Component> = {
  welcome: WelcomeScreen,
  connecting: ConnectingScreen,
  browser: BrowserScreen,
  error: ErrorScreen,
  home: HomeScreen,
  homeEmpty: HomeEmptyScreen,
  kickbacks: KickbacksScreen,
  plan: PlanScreen,
  pool: PoolScreen,
  pools: PoolsScreen,
  stake: StakeScreen,
  approve: ApproveScreen,
  success: SuccessScreen,
  run: RunScreen,
}
