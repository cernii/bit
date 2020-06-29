import React from 'react';
import { useQuery } from '@apollo/react-hooks';
import { gql } from 'apollo-boost';
import { useRouteMatch } from 'react-router-dom';
import { ComponentProvider } from './context';
import { TopBar } from './top-bar';
import styles from './component.module.scss';
import { ComponentModel } from './component-model';
import { NavigationSlot, RouteSlot, SlotSubRouter } from '../../react-router/slot-router';

const GET_COMPONENT = gql`
  query Component($id: String!) {
    workspace {
      getComponent(id: $id) {
        id
        server {
          env
          url
        }
      }
    }
  }
`;

// TEMP!
const currentTag = {
  version: '5.0.10',
  downloads: 542,
  likes: 86
};

export type ComponentProps = {
  navSlot: NavigationSlot;
  routeSlot: RouteSlot;
};

/**
 * main UI component of the Component extension.
 */
export function Component({ navSlot, routeSlot }: ComponentProps) {
  const {
    params: { componentId }
  } = useRouteMatch();

  const { loading, error, data } = useQuery(GET_COMPONENT, {
    variables: { id: componentId }
  });

  // :TODO @uri please add a proper loader with amir
  if (loading) return <div>loading</div>;
  if (error) throw error;

  const component = ComponentModel.from(data.workspace.getComponent);

  return (
    <ComponentProvider component={component}>
      <TopBar className={styles.topbar} navigationSlot={navSlot} currentTag={currentTag} />
      {routeSlot && <SlotSubRouter slot={routeSlot} />}
    </ComponentProvider>
  );
}
