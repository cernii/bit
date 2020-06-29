import React from 'react';
import { Route, RouteProps, NavLinkProps } from 'react-router-dom';
import { Slot } from '@teambit/harmony';
import { WorkspaceUI } from '../workspace/workspace.ui';
import { Component } from './ui/component';
import { RouteSlot, NavigationSlot } from '../react-router/slot-router';

export type Server = {
  env: string;
  url: string;
};

export type Component = {
  id: string;
  server: Server;
};

export type MenuItem = {
  label: JSX.Element | string | null;
};

const componentIdUrlRegex = '[\\w/-]+';

export class ComponentUI {
  constructor(private routeSlot: RouteSlot, private navSlot: NavigationSlot) {}

  /**
   * expose the route for a component.
   */
  get componentRoute() {
    return {
      path: `/:componentId(${componentIdUrlRegex})`,
      children: <Component navSlot={this.navSlot} routeSlot={this.routeSlot} />
    };
  }

  registerRoute(route: RouteProps) {
    this.routeSlot.register(route);
    return this;
  }

  registerNavigation(nav: NavLinkProps) {
    this.navSlot.register(nav);
  }

  static dependencies = [WorkspaceUI];

  static slots = [Slot.withType<RouteProps>(), Slot.withType<NavigationSlot>()];

  static async provider([workspace]: [WorkspaceUI], config, [routeSlot, navSlot]: [RouteSlot, NavigationSlot]) {
    const componentUI = new ComponentUI(routeSlot, navSlot);
    workspace.registerRoute(componentUI.componentRoute);
    return componentUI;
  }
}
