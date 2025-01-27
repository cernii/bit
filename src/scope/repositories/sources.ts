import R from 'ramda';
import { isHash } from '@teambit/component-version';
import { BitId, BitIds } from '../../bit-id';
import { COMPONENT_ORIGINS, Extensions } from '../../constants';
import ConsumerComponent from '../../consumer/component';
import { revertDirManipulationForPath } from '../../consumer/component-ops/manipulate-dir';
import AbstractVinyl from '../../consumer/component/sources/abstract-vinyl';
import { ArtifactFiles, ArtifactSource, getArtifactsFiles } from '../../consumer/component/sources/artifact-files';
import Consumer from '../../consumer/consumer';
import GeneralError from '../../error/general-error';
import logger from '../../logger/logger';
import { PathLinux, PathOsBased } from '../../utils/path';
import ComponentObjects from '../component-objects';
import { getAllVersionHashes, getAllVersionsInfo } from '../component-ops/traverse-versions';
import { ComponentNotFound, MergeConflict } from '../exceptions';
import ComponentNeedsUpdate from '../exceptions/component-needs-update';
import UnmergedComponents from '../lanes/unmerged-components';
import { ModelComponent, Source, Symlink, Version } from '../models';
import Lane from '../models/lane';
import { ComponentProps } from '../models/model-component';
import { BitObject, Ref } from '../objects';
import Repository from '../objects/repository';
import Scope from '../scope';

export type ComponentTree = {
  component: ModelComponent;
  objects: BitObject[];
};

export type LaneTree = {
  lane: Lane;
  objects: BitObject[];
};

export type ComponentDef = {
  id: BitId;
  component: ModelComponent | null | undefined;
};

export default class SourceRepository {
  scope: Scope;

  constructor(scope: Scope) {
    this.scope = scope;
  }

  objects() {
    return this.scope.objects;
  }

  getMany(ids: BitId[] | BitIds): Promise<ComponentDef[]> {
    logger.debug(`sources.getMany, Ids: ${ids.join(', ')}`);
    return Promise.all(
      ids.map((id) => {
        return this.get(id).then((component) => {
          return {
            id,
            component,
          };
        });
      })
    );
  }

  async get(bitId: BitId): Promise<ModelComponent | undefined> {
    const component = ModelComponent.fromBitId(bitId);
    const foundComponent: ModelComponent | undefined = await this._findComponent(component);
    if (foundComponent && bitId.hasVersion()) {
      // @ts-ignore
      const isSnap = isHash(bitId.version);
      const msg = `found ${bitId.toStringWithoutVersion()}, however version ${bitId.getVersion().versionNum}`;
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      if (isSnap) {
        // @ts-ignore
        const snap = await this.objects().load(new Ref(bitId.version));
        if (!snap) {
          logger.debugAndAddBreadCrumb('sources.get', `${msg} object was not found on the filesystem`);
          return undefined;
        }
        return foundComponent;
      }
      // @ts-ignore
      if (!foundComponent.hasTag(bitId.version)) {
        logger.debugAndAddBreadCrumb('sources.get', `${msg} is not in the component versions array`);
        return undefined;
      }
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      const version = await this.objects().load(foundComponent.versions[bitId.version]);
      if (!version) {
        logger.debugAndAddBreadCrumb('sources.get', `${msg} object was not found on the filesystem`);
        return undefined;
      }
    }

    return foundComponent;
  }

  async _findComponent(component: ModelComponent): Promise<ModelComponent | undefined> {
    try {
      const foundComponent = await this.objects().load(component.hash());
      if (foundComponent instanceof Symlink) {
        return this._findComponentBySymlink(foundComponent);
      }
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      if (foundComponent) return foundComponent;
    } catch (err) {
      logger.error(`findComponent got an error ${err}`);
    }
    logger.debug(`failed finding a component ${component.id()} with hash: ${component.hash().toString()}`);
    return undefined;
  }

  async _findComponentBySymlink(symlink: Symlink): Promise<ModelComponent | undefined> {
    const realComponentId: BitId = symlink.getRealComponentId();
    const realModelComponent = ModelComponent.fromBitId(realComponentId);
    const foundComponent = await this.objects().load(realModelComponent.hash());
    if (!foundComponent) {
      throw new Error(
        `error: found a symlink object "${symlink.id()}" that references to a non-exist component "${realComponentId.toString()}".
if you have the steps to reproduce the issue, please open a Github issue with the details.
to quickly fix the issue, please delete the object at "${this.objects().objectPath(symlink.hash())}"`
      );
    }
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    return foundComponent;
  }

  getObjects(id: BitId): Promise<ComponentObjects> {
    return this.get(id).then((component) => {
      if (!component) throw new ComponentNotFound(id.toString());
      return component.collectObjects(this.objects());
    });
  }

  findOrAddComponent(props: ComponentProps): Promise<ModelComponent> {
    const comp = ModelComponent.from(props);
    return this._findComponent(comp).then((component) => {
      if (!component) return comp;
      return component;
    });
  }

  modifyCIProps({ source, ciProps }: { source: ConsumerComponent; ciProps: Record<string, any> }): Promise<any> {
    const objectRepo = this.objects();

    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    return this.findOrAddComponent(source).then((component) => {
      return component.loadVersion(component.latest(), objectRepo).then((version) => {
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        version.setCIProps(ciProps);
        return objectRepo._writeOne(version);
      });
    });
  }

  modifySpecsResults({ source, specsResults }: { source: ConsumerComponent; specsResults?: any }): Promise<any> {
    const objectRepo = this.objects();

    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    return this.findOrAddComponent(source).then((component) => {
      return component.loadVersion(component.latest(), objectRepo).then((version) => {
        version.setSpecsResults(specsResults);
        return objectRepo._writeOne(version);
      });
    });
  }

  // TODO: This should treat dist as an array
  updateDist({ source }: { source: ConsumerComponent }): Promise<any> {
    const objectRepo = this.objects();

    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    return this.findOrAddComponent(source).then((component) => {
      return component.loadVersion(component.latest(), objectRepo).then((version) => {
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        const dist = source.dist ? Source.from(Buffer.from(source.dist.toString())) : undefined;
        version.setDist(dist);
        objectRepo.add(dist).add(version);
        return objectRepo.persist();
      });
    });
  }

  private transformArtifactsFromVinylToSource(artifactsFiles: ArtifactFiles[]): ArtifactSource[] {
    const artifacts: ArtifactSource[] = [];
    artifactsFiles.forEach((artifactFiles) => {
      const artifactsSource = ArtifactFiles.fromVinylsToSources(artifactFiles.vinyls);
      if (artifactsSource.length) artifactFiles.populateRefsFromSources(artifactsSource);
      artifacts.push(...artifactsSource);
    });
    return artifacts;
  }

  /**
   * given a consumer-component object, returns the Version representation.
   * useful for saving into the model or calculation the hash for comparing with other Version object.
   * among other things, it reverts the path manipulation that was done when a component was loaded
   * from the filesystem. it adds the originallySharedDir and strip the wrapDir.
   *
   * warning: Do not change anything on the consumerComponent instance! Only use its clone.
   *
   * @see model-components.toConsumerComponent() for the opposite action. (converting Version to
   * ConsumerComponent).
   */
  async consumerComponentToVersion({
    consumerComponent,
    consumer,
  }: {
    readonly consumerComponent: ConsumerComponent;
    consumer: Consumer;
    force?: boolean;
    verbose?: boolean;
  }): Promise<{ version: Version; files: any; dists: any; compilerFiles: any; testerFiles: any }> {
    const clonedComponent: ConsumerComponent = consumerComponent.clone();
    const setEol = (files: AbstractVinyl[]) => {
      if (!files) return null;
      const result = files.map((file) => {
        // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
        file.file = file.toSourceAsLinuxEOL();
        return file;
      });
      return result;
    };
    const manipulateDirs = (pathStr: PathOsBased): PathLinux => {
      return revertDirManipulationForPath(pathStr, clonedComponent.originallySharedDir, clonedComponent.wrapDir);
    };

    const files = consumerComponent.files.map((file) => {
      return {
        name: file.basename,
        relativePath: manipulateDirs(file.relative),
        file: file.toSourceAsLinuxEOL(),
        test: file.test,
      };
    });
    // @todo: is this the best way to find out whether a compiler is set?
    const isCompileSet = Boolean(
      consumerComponent.compiler ||
        clonedComponent.extensions.some(
          (e) => e.name === Extensions.compiler || e.name === 'bit.core/compile' || e.name === Extensions.envs
        )
    );
    const { dists, mainDistFile } = clonedComponent.dists.toDistFilesModel(
      consumer,
      consumerComponent.originallySharedDir,
      isCompileSet
    );

    const compilerFiles = setEol(R.path(['compiler', 'files'], consumerComponent));
    const testerFiles = setEol(R.path(['tester', 'files'], consumerComponent));

    clonedComponent.mainFile = manipulateDirs(clonedComponent.mainFile);
    clonedComponent.getAllDependencies().forEach((dependency) => {
      // ignoreVersion because when persisting the tag is higher than currently exist in .bitmap
      const depFromBitMap = consumer.bitMap.getComponentIfExist(dependency.id, { ignoreVersion: true });
      dependency.relativePaths.forEach((relativePath) => {
        if (!relativePath.isCustomResolveUsed) {
          // for isCustomResolveUsed it was never stripped
          relativePath.sourceRelativePath = manipulateDirs(relativePath.sourceRelativePath);
        }
        if (depFromBitMap && depFromBitMap.origin !== COMPONENT_ORIGINS.AUTHORED) {
          // when a dependency is not authored, we need to also change the
          // destinationRelativePath, which is the path written in the link file, however, the
          // dir manipulation should be according to this dependency component, not the
          // consumerComponent passed to this function
          relativePath.destinationRelativePath = revertDirManipulationForPath(
            relativePath.destinationRelativePath,
            depFromBitMap.originallySharedDir,
            depFromBitMap.wrapDir
          );
        }
      });
    });
    clonedComponent.overrides.addOriginallySharedDir(clonedComponent.originallySharedDir);
    const version: Version = Version.fromComponent({
      component: clonedComponent,
      files: files as any,
      dists,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      mainDistFile,
    });
    // $FlowFixMe it's ok to override the pendingVersion attribute
    consumerComponent.pendingVersion = version as any; // helps to validate the version against the consumer-component

    return { version, files, dists, compilerFiles, testerFiles };
  }

  async enrichSource(consumerComponent: ConsumerComponent) {
    const objectRepo = this.objects();
    const objects = await this.getObjectsToEnrichSource(consumerComponent);
    objects.forEach((obj) => objectRepo.add(obj));
    return consumerComponent;
  }

  async getObjectsToEnrichSource(consumerComponent: ConsumerComponent): Promise<BitObject[]> {
    const component = await this.findOrAddComponent(consumerComponent);
    const version = await component.loadVersion(consumerComponent.id.version as string, this.objects());
    const artifactFiles = getArtifactsFiles(consumerComponent.extensions);
    const artifacts = this.transformArtifactsFromVinylToSource(artifactFiles);
    version.extensions = consumerComponent.extensions;
    version.buildStatus = consumerComponent.buildStatus;
    const artifactObjects = artifacts.map((file) => file.source);
    return [version, ...artifactObjects];
  }

  async addSource({
    source,
    consumer,
    lane,
    resolveUnmerged = false,
  }: {
    source: ConsumerComponent;
    consumer: Consumer;
    lane: Lane | null;
    resolveUnmerged?: boolean;
  }): Promise<ModelComponent> {
    const objectRepo = this.objects();
    // if a component exists in the model, add a new version. Otherwise, create a new component on the model
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const component = await this.findOrAddComponent(source);
    const unmergedComponent = consumer.scope.objects.unmergedComponents.getEntry(component.name);
    if (unmergedComponent && !unmergedComponent.resolved && !resolveUnmerged) {
      throw new GeneralError(
        `unable to snap/tag "${component.name}", it is unmerged with conflicts. please run "bit merge <id> --resolve"`
      );
    }
    const artifactFiles = getArtifactsFiles(source.extensions);
    const artifacts = this.transformArtifactsFromVinylToSource(artifactFiles);
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const { version, files, dists, compilerFiles, testerFiles } = await this.consumerComponentToVersion({
      consumerComponent: source,
      consumer,
    });
    objectRepo.add(version);
    if (!source.version) throw new Error(`addSource expects source.version to be set`);
    component.addVersion(version, source.version, lane, objectRepo);

    if (unmergedComponent) {
      version.addParent(unmergedComponent.head);
      version.log.message = version.log.message
        ? version.log.message
        : UnmergedComponents.buildSnapMessage(unmergedComponent);
      consumer.scope.objects.unmergedComponents.removeComponent(component.name);
    }
    objectRepo.add(component);

    files.forEach((file) => objectRepo.add(file.file));
    if (dists) dists.forEach((dist) => objectRepo.add(dist.file));
    if (compilerFiles) compilerFiles.forEach((file) => objectRepo.add(file.file));
    if (testerFiles) testerFiles.forEach((file) => objectRepo.add(file.file));
    if (artifacts) artifacts.forEach((file) => objectRepo.add(file.source));

    return component;
  }

  putModelComponent(component: ModelComponent) {
    const repo: Repository = this.objects();
    repo.add(component);
  }

  put({ component, objects }: ComponentTree): ModelComponent {
    logger.debug(`sources.put, id: ${component.id()}, versions: ${component.listVersions().join(', ')}`);
    const repo: Repository = this.objects();
    repo.add(component);

    const isObjectShouldBeAdded = (obj) => {
      // don't add a component if it's already exist locally with more versions
      if (obj instanceof ModelComponent) {
        const loaded = repo.loadSync(obj.hash(), false);
        if (loaded) {
          // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
          if (Object.keys(loaded.versions) > Object.keys(obj.versions)) {
            return false;
          }
        }
      }
      return true;
    };

    objects.forEach((obj) => {
      if (isObjectShouldBeAdded(obj)) repo.add(obj);
    });
    return component;
  }

  putObjects(objects: BitObject[]) {
    const repo: Repository = this.objects();
    objects.forEach((obj) => repo.add(obj));
  }

  /**
   * remove specified component versions from component.
   * if all versions of a component were deleted, delete also the component.
   * it doesn't persist anything to the filesystem.
   * (repository.persist() needs to be called at the end of the operation)
   */
  removeComponentVersions(component: ModelComponent, versions: string[], allVersionsObjects: Version[]): void {
    logger.debug(`removeComponentVersion, component ${component.id()}, versions ${versions.join(', ')}`);
    const objectRepo = this.objects();
    versions.forEach((version) => {
      const ref = component.removeVersion(version);
      const refStr = ref.toString();
      const versionObject = allVersionsObjects.find((v) => v.hash().isEqual(ref));
      if (!versionObject) throw new Error(`removeComponentVersions failed finding a version object of ${refStr}`);
      // update the snap head if needed
      if (component.getHeadStr() === refStr) {
        if (versionObject.parents.length > 1)
          throw new Error(
            `removeComponentVersions found multiple parents for a local (un-exported) version ${version} of ${component.id()}`
          );
        const head = versionObject.parents.length === 1 ? versionObject.parents[0] : undefined;
        component.setHead(head);
      }
      // update other versions parents if they point to the deleted version
      allVersionsObjects.forEach((obj) => {
        if (obj.hasParent(ref)) {
          obj.removeParent(ref);
          objectRepo.add(obj);
        }
      });

      objectRepo.removeObject(ref);
    });

    if (component.versionArray.length || component.hasHead()) {
      objectRepo.add(component); // add the modified component object
    } else {
      // @todo: make sure not to delete the component when it has snaps but not versions!
      // if all versions were deleted, delete also the component itself from the model
      objectRepo.removeObject(component.hash());
    }
    objectRepo.unmergedComponents.removeComponent(component.name);
  }

  /**
   * @see this.removeComponent()
   *
   */
  async removeComponentById(bitId: BitId): Promise<void> {
    logger.debug(`sources.removeComponentById: ${bitId.toString()}`);
    const component = await this.get(bitId);
    if (!component) return;
    this.removeComponent(component);
  }

  /**
   * remove all versions objects of the component from local scope.
   * if deepRemove is true, it removes also the refs associated with the removed versions.
   * finally, it removes the component object itself
   * it doesn't physically delete from the filesystem.
   * the actual delete is done at a later phase, once Repository.persist() is called.
   *
   * @param {ModelComponent} component
   * @param {boolean} [deepRemove=false] - whether remove all the refs or only the version array
   */
  removeComponent(component: ModelComponent): void {
    const repo = this.objects();
    logger.debug(`sources.removeComponent: removing a component ${component.id()} from a local scope`);
    const objectRefs = component.versionArray;
    objectRefs.push(component.hash());
    repo.removeManyObjects(objectRefs);
    repo.unmergedComponents.removeComponent(component.name);
  }

  /**
   * merge the existing component with the data from the incoming component
   * here, we assume that there is no conflict between the two, otherwise, this.merge() would throw
   * a MergeConflict exception.
   */
  mergeTwoComponentsObjects(
    existingComponent: ModelComponent,
    incomingComponent: ModelComponent,
    existingComponentTagsAndSnaps: string[],
    incomingComponentTagsAndSnaps: string[]
  ): { mergedComponent: ModelComponent; mergedVersions: string[] } {
    // the base component to save is the existingComponent because it might contain local data that
    // is not available in the remote component, such as the "state" property.
    const mergedComponent = existingComponent;
    const mergedVersions: string[] = [];
    // in case the existing version hash is different than incoming version hash, use the incoming
    // version because we hold the incoming component from a remote as the source of truth
    Object.keys(existingComponent.versions).forEach((existingVersion) => {
      if (
        incomingComponent.versions[existingVersion] &&
        existingComponent.versions[existingVersion].toString() !==
          incomingComponent.versions[existingVersion].toString()
      ) {
        mergedComponent.versions[existingVersion] = incomingComponent.versions[existingVersion];
        mergedVersions.push(existingVersion);
      }
    });
    // in case the incoming component has versions that are not in the existing component, copy them
    Object.keys(incomingComponent.versions).forEach((incomingVersion) => {
      if (!existingComponent.versions[incomingVersion]) {
        mergedComponent.versions[incomingVersion] = incomingComponent.versions[incomingVersion];
        mergedVersions.push(incomingVersion);
      }
    });
    if (incomingComponent.hasHead()) {
      const mergedSnaps = incomingComponentTagsAndSnaps.filter(
        (tagOrSnap) => !existingComponentTagsAndSnaps.includes(tagOrSnap) && !mergedVersions.includes(tagOrSnap)
      );
      mergedVersions.push(...mergedSnaps);
    }

    return { mergedComponent, mergedVersions };
  }

  /**
   * Adds the objects into scope.object array, in-memory. It doesn't save anything to the file-system.
   *
   * When this function gets called originally from import command, the 'local' parameter is true. Otherwise, if it was
   * originated from export command, it'll be false.
   * If the 'local' is true and the existing component wasn't changed locally, it doesn't check for
   * discrepancies, but simply override the existing component.
   * In this context, "discrepancy" means, same version but different hashes.
   * When using import command, it makes sense to override a component in case of discrepancies because the source of
   * truth should be the remote scope from where the import fetches the component.
   * When the same component has different versions in the remote and the local, it merges the two
   * by calling this.mergeTwoComponentsObjects().
   *
   * when dealing with lanes, exporting/importing lane's components, this function doesn't do much
   * if any. that's because the head is not saved on the ModelComponent but on the lane object.
   * to rephrase with other words,
   * this function merges an incoming modelComponent with an existing modelComponent, so if all
   * changes where done on a lane, this function will not do anything because modelComponent
   * hasn't changed.
   */
  async merge(
    component: ModelComponent,
    versionObjects: Version[],
    local = true
  ): Promise<{ mergedComponent: ModelComponent; mergedVersions: string[] }> {
    const existingComponent: ModelComponent | null | undefined = await this._findComponent(component);
    // @ts-ignore
    // const versionObjects: Version[] = objects.filter((o) => o instanceof Version);
    // don't throw if not found because on export not all objects are sent to the remote
    const allVersionsInfo = await getAllVersionsInfo({ modelComponent: component, throws: false, versionObjects });
    const allHashes = allVersionsInfo.map((v) => v.ref).filter((ref) => ref) as Ref[];
    const tagsAndSnaps = component.switchHashesWithTagsIfExist(allHashes);
    if (!existingComponent) {
      this.putModelComponent(component);
      return { mergedComponent: component, mergedVersions: tagsAndSnaps };
    }
    const hashesOfHistoryGraph = allVersionsInfo
      .map((v) => (v.isPartOfHistory ? v.ref : null))
      .filter((ref) => ref) as Ref[];
    const existingComponentHead = existingComponent.getHead();
    const existingHeadIsMissingInIncomingComponent =
      component.hasHead() &&
      existingComponentHead &&
      !hashesOfHistoryGraph.find((ref) => ref.isEqual(existingComponentHead));
    if (
      !local &&
      existingHeadIsMissingInIncomingComponent &&
      component.compatibleWith(existingComponent, local) // otherwise, it should throw MergeConflict below
    ) {
      // @ts-ignore
      throw new ComponentNeedsUpdate(component.id(), existingComponentHead.toString());
    }
    // @todo lanes: should we pass the local lane to `isLocallyChanged`?
    const locallyChanged = await existingComponent.isLocallyChanged();
    if ((local && !locallyChanged) || component.compatibleWith(existingComponent, local)) {
      logger.debug(`sources.merge component ${component.id()}`);
      const repo: Repository = this.objects();
      const existingComponentHashes = await getAllVersionHashes(existingComponent, repo, false);
      const existingComponentTagsAndSnaps = existingComponent.switchHashesWithTagsIfExist(existingComponentHashes);
      const { mergedComponent, mergedVersions } = this.mergeTwoComponentsObjects(
        existingComponent,
        component,
        existingComponentTagsAndSnaps,
        tagsAndSnaps
      );
      const componentHead = component.getHead();
      if (componentHead) {
        // when importing (local), do not override the head unless the incoming is ahead.
        if (!local || !existingHeadIsMissingInIncomingComponent) {
          mergedComponent.setHead(componentHead);
        }
        if (local) mergedComponent.remoteHead = componentHead;
      }

      this.putModelComponent(mergedComponent);
      return { mergedComponent, mergedVersions };
    }

    const conflictVersions = component.diffWith(existingComponent, local);
    throw new MergeConflict(component.id(), conflictVersions);
  }

  /**
   * the merge is needed only when both, local lane and remote lane have the same component with
   * a different head.
   * the different head can be a result of one component is ahead of the other (fast-forward is
   *  possible), or they both have diverged.
   *
   * 1a) fast-forward case, existing is ahead. existing has snapA => snapB, incoming has snapA.
   * we can just ignore the incoming.
   *
   * 1b) fast-forward case, incoming is ahead. existing has snapA, incoming has snapA => snapB.
   * we should update the existing head according to the incoming.
   *
   * 2) true-merge case, existing has snapA => snapB, incoming has snapA => snapC.
   *
   * in case this is a remote (the incoming component comes as a result of export):
   * throw an error telling the client to pull the lane from the remote in order to merge the
   * new snaps. the client during the merge process will create a snap-merge that is going to be
   * the new head, which eventually becoming the case 1b.
   *
   * in case this is a local (the incoming component comes as a result of import):
   * do not update the lane object. only save the data on the refs/remote/lane-name.
   */
  async mergeLane(
    lane: Lane,
    local: boolean
  ): Promise<Array<{ mergedComponent: ModelComponent; mergedVersions: string[] } | ComponentNeedsUpdate>> {
    const repo = this.objects();
    const existingLane = await this.scope.loadLane(lane.toLaneId());
    if (!existingLane) {
      repo.add(lane);
    }
    const mergeResults = await Promise.all(
      lane.components.map(async (component) => {
        const modelComponent = await this.get(component.id);
        if (!modelComponent) {
          throw new Error(`unable to merge lane ${lane.name}, the component ${component.id.toString()} was not found`);
        }
        const existingComponent = existingLane ? existingLane.components.find((c) => c.id.isEqual(component.id)) : null;
        if (!existingComponent) {
          modelComponent.laneHeadLocal = component.head;
          const allVersions = await getAllVersionHashes(modelComponent, repo);
          if (existingLane) existingLane.addComponent(component);
          return { mergedComponent: modelComponent, mergedVersions: allVersions.map((h) => h.toString()) };
        }
        if (existingComponent.head.isEqual(component.head)) {
          return { mergedComponent: modelComponent, mergedVersions: [] };
        }
        modelComponent.laneHeadRemote = component.head;
        modelComponent.laneHeadLocal = existingComponent.head;
        await modelComponent.setDivergeData(repo);
        const divergeResults = modelComponent.getDivergeData();
        if (divergeResults.isDiverged()) {
          if (local) {
            // do not update the local lane. later, suggest to snap-merge.
            return { mergedComponent: modelComponent, mergedVersions: [] };
          }
          return new ComponentNeedsUpdate(component.id.toString(), existingComponent.head.toString());
        }
        if (divergeResults.isRemoteAhead()) {
          existingComponent.head = component.head;
          return {
            mergedComponent: modelComponent,
            mergedVersions: divergeResults.snapsOnRemoteOnly.map((h) => h.toString()),
          };
        }
        // local is ahead, nothing to merge.
        return { mergedComponent: modelComponent, mergedVersions: [] };
      })
    );
    repo.add(existingLane);
    // objects.forEach((obj) => repo.add(obj));
    return mergeResults;
  }
}
