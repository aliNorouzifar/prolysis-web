import pm4py
from .subprocess_calls import discover_declare_no_prune
from prolysis.declare import evaluate_log
from .utils import read_json_file, save_json_file, import_csv_as_dataframe
from .encoding_functions import combine_models, extract_trace_variants, encode, re_write_model
from .classification import prepare_data
import numpy as np
import pandas as pd
import os
import matplotlib.pyplot as plt
import json
from sklearn.model_selection import train_test_split
from rulefit import RuleFit
import seaborn as sns
import matplotlib as mpl
import uuid
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from imblearn.under_sampling import RandomUnderSampler
from imblearn.over_sampling import RandomOverSampler
from scipy.cluster.hierarchy import dendrogram, linkage
from scipy.spatial.distance import squareform
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm
from scipy.cluster.hierarchy import fcluster
from pm4py.algo.filtering.log.variants import variants_filter
from io import BytesIO  # To handle the in-memory buffer
import base64  # To encode the image for embedding in HTML
import joblib
from sklearn.model_selection import GridSearchCV

from sklearn.metrics import accuracy_score, confusion_matrix, classification_report
import wittgenstein as lw
import operator
from functools import reduce
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.tools.tools import add_constant

variant = "RuleFit"

mapping = {
    'Absence': "Absence",
    'AtLeast1': "Participation",
    # 'AtMost1': "AtMostOne",  #it has a problem in Janus (vac_sac when a has not occured!)
    'Init': "Init",
    'End': "End",
    'RespondedExistence': "RespondedExistence",
    'Response': "Response",
    'AlternateResponse': "AlternateResponse",
    'ChainResponse': "ChainResponse",
    'Precedence': "Precedence",
    'AlternatePrecedence': "AlternatePrecedence",
    'ChainPrecedence': "ChainPrecedence",
    "CoExistence": "CoExistence",
    'Succession': "Succession",
    'AlternateSuccession': "AlternateSuccession",
    'ChainSuccession': "ChainSuccession",
    'NotSuccession': "NotSuccession",
    'NotCoExistence': "NotCoExistence",
    # 'NotChainSuccession': "NotChainSuccession",  # Janus never evaluated this template
    # (it silently omitted every NotChainSuccession from its event-level output), so it
    # was never a discriminative feature. Excluded here to keep the feature set identical
    # to the legacy Janus-based results. prolysis.declare can evaluate it if ever needed.
}

reversed_mapping = {v: k for k, v in mapping.items()}


def Ripper(X_train, y_train,X):
    ######### Ripper
    X_train =X_train.reset_index(drop=True)
    y_train = y_train.reset_index(drop=True)
    model = lw.RIPPER(k=10, verbosity=1)
    model.fit(X_train, y_train)

    # Predict on test data
    # y_pred = model.predict(X_test)

    # Evaluate model
    # accuracy = accuracy_score(y_test, y_pred)
    # print(f"Accuracy: {accuracy:.2f}")

    # Print learned rules
    print(model.ruleset_)

    # new_df = pd.DataFrame(index=X.index)
    # rules_list = []
    # for i, rule in enumerate(model.ruleset_):
    #     # Extract the filtering conditions from the rule.
    #     filtering_conds = [(cond.feature, cond.val) for cond in rule.conds]
    #     # Create a boolean mask that is the logical AND of all conditions.
    #     mask = reduce(operator.and_, [(X[feature] == value) for feature, value in filtering_conds])
    #     # Convert the boolean mask to integers (1 if True, 0 if False).
    #     mask_int = mask.astype(int)
    #     # Add the mask as a new column in new_df, naming the column with the string representation of the rule.
    #     new_df[str(rule)] = mask_int
    #     rules_list.append(str(rule))
    rules_list, new_df = extract_rules_ripper(X,model)
    return model, rules_list, new_df

def extract_rules_ripper(X,model):
    new_df = pd.DataFrame(index=X.index)
    rules_list = []
    for i, rule in enumerate(model.ruleset_):
        # Extract the filtering conditions from the rule.
        filtering_conds = [(cond.feature, cond.val) for cond in rule.conds]
        # Create a boolean mask that is the logical AND of all conditions.
        mask = reduce(operator.and_, [(X[feature] == value) for feature, value in filtering_conds])
        # Convert the boolean mask to integers (1 if True, 0 if False).
        mask_int = mask.astype(int)
        # Add the mask as a new column in new_df, naming the column with the string representation of the rule.
        new_df[str(rule)] = mask_int
        rules_list.append(str(rule))
    return rules_list, new_df

def jaccard_calc(rules_list, data):
    # -----------------------------------------------------------
    # For each filtered rule, compute the Jaccard distance between the sets of indices (rows) where the rule is active.

    n_rules = len(rules_list)
    jaccard_matrix = np.zeros((n_rules, n_rules))

    for i, rule_i in enumerate(rules_list):
        vec_i = data[rule_i].astype(bool)  # True where rule applies.
        for j, rule_j in enumerate(rules_list):
            vec_j = data[rule_j].astype(bool)
            intersection = np.sum(vec_i & vec_j)
            union = np.sum(vec_i | vec_j)
            jaccard_sim = intersection / union if union > 0 else 0
            jaccard_matrix[i, j] = 1 - jaccard_sim  # Jaccard distance
            # print(f"{rule_i}, {rule_j}, Jaccard: {jaccard_sim}")

    # --- Hierarchical Clustering and Clustermap with Custom Red/Green Rule Importance --

    # Create the full Jaccard distance DataFrame.
    jaccard_df = pd.DataFrame(jaccard_matrix, index=rules_list, columns=rules_list)

    # Convert the full square Jaccard matrix to condensed form.
    condensed_jaccard = squareform(jaccard_matrix)

    return jaccard_df, condensed_jaccard


def normalized_hamming_calc(rules_list, data):
    """
    For each filtered rule, compute the normalized Hamming distance between the binary vectors
    corresponding to the rules in the provided data.

    Parameters:
        rules_list (list): List of column names (rules) to compare.
        data (DataFrame): Pandas DataFrame containing the binary features.

    Returns:
        hamming_df (DataFrame): Square DataFrame of normalized Hamming distances with rules as indices and columns.
        condensed_hamming (ndarray): Condensed form of the distance matrix.
    """

    n_rules = len(rules_list)
    hamming_matrix = np.zeros((n_rules, n_rules))

    for i, rule_i in enumerate(rules_list):
        # Convert the rule column to a boolean vector
        vec_i = data[rule_i].astype(bool)
        for j, rule_j in enumerate(rules_list):
            vec_j = data[rule_j].astype(bool)
            # Compute normalized Hamming distance as the mean of mismatches
            norm_hamming = np.mean(vec_i != vec_j)
            hamming_matrix[i, j] = norm_hamming

    # Create a DataFrame from the full Hamming distance matrix.
    hamming_df = pd.DataFrame(hamming_matrix, index=rules_list, columns=rules_list)

    # Convert the full square matrix to condensed form for use with hierarchical clustering
    condensed_hamming = squareform(hamming_matrix)

    return hamming_df, condensed_hamming


def compute_stats(rule_str, X_rules_df, y):
    """Computes support for a given rule in each class."""
    try:
        all_count = X_rules_df.shape[0]
        all_P = sum(y['label'])
        all_M = all_count - all_P
        support = sum(X_rules_df[rule_str])
        support_P =sum(X_rules_df[rule_str]&y['label'])
        support_M = sum(X_rules_df[rule_str]&~y['label'])
        return {"support":round(support/all_count,2), r'$support(L^+,r)$':round(support_P/all_P,2), r'$support(L^-,r)$':round(support_M/all_M,2)}
    except:
        return None  # Some rules may not be parseable with pandas query

def compute_stats_ripper(rule, X_rules_df, y):
    """Computes support for a given rule in each class."""
    try:
        all_count = X_rules_df.shape[0]
        all_P = sum(y['label'])
        all_M = all_count - all_P
        support = sum(X_rules_df[rule])
        support_P =sum(X_rules_df[rule]&y['label'])
        support_M = sum(X_rules_df[rule]&~y['label'])
        return {"support":round(support/all_count,2), "support_P":round(support_P/all_P,2), "support_M":round(support_M/all_M,2)}
    except:
        return None  # Some rules may not be parseable with pandas query


def decompose_string(input_str, reversed_mapping):
    """
    Parses an input string in the format:
        template(act1, act2)
    or
        template(act1)
    and returns three values: template, act1, act2.
    If there is only one argument (e.g. "exactly1(aaa)"), act2 will be None.
    """
    input_str = input_str.strip()
    left_paren_index = input_str.index('(')
    template = reversed_mapping[input_str[:left_paren_index].strip()]

    if input_str.strip()[-1] == ')':
        inside = input_str[left_paren_index + 1:-1]
    else:
        inside = input_str[left_paren_index + 1:]

    depth = 0
    comma_index = None
    for i, char in enumerate(inside):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif char == ',' and depth == 0:
            comma_index = i
            break

    if comma_index is None:
        act1 = inside.strip()
        act2 = None
    else:
        act1 = inside[:comma_index].strip()
        act2 = inside[comma_index + 1:].strip()

    return template, act1, act2


def export_constraints(global_fvi_df, tasks, constraints_json_path, reversed_mapping, c):
    dict_out = {}
    dict_out["tasks"] = tasks
    dict_out["constraints"] = []
    for constraint in global_fvi_df.index:
        if abs(global_fvi_df.loc[constraint]['Feature Value Importance']) > 0:
            template, act1, act2 = decompose_string(constraint, reversed_mapping)
            temp_dict = {}
            temp_dict["template"] = template
            temp_dict['parameters'] = []
            temp_dict['parameters'].append([act1])
            if act2 is not None:
                temp_dict['parameters'].append([act2])
            temp_dict['desirability'] = global_fvi_df.loc[constraint]['Feature Value Importance']
            temp_dict['support'] = 0.0
            temp_dict['confidence'] = 0.0
            dict_out["constraints"].append(temp_dict)

    with open(os.path.join(constraints_json_path, f"des_{round(c * 100)}.json"), 'w') as fp:
        json.dump(dict_out, fp, indent=4)
        fp.close()

def trace_variant(trace):
    # Assumes each event in the trace has an attribute "concept:name" that represents the activity
    return "<" + ",".join([event["concept:name"] for event in trace]) + ">"


def process_event_log_instances(instance_strings, base_time="2020-01-01 00:00:00", unit="s"):
    """
    Given a list of instance strings (each formatted as "<ACT1,ACT2,...>"),
    returns a DataFrame with three columns: 'CaseID', 'Activity', and 'Timestamp'.
    Each instance string is assigned a unique CaseID, each activity in the string becomes
    a separate row, and a dummy timestamp is added in a standard time format.

    Parameters:
      instance_strings (list): List of strings formatted as "<ACT1,ACT2,...>"
      base_time (str or pd.Timestamp): Starting timestamp (default "2020-01-01 00:00:00").
      unit (str): Time unit to increment per row (e.g., 's' for seconds, 'min' for minutes).

    Returns:
      pd.DataFrame: DataFrame with columns 'CaseID', 'Activity', 'Timestamp'
    """
    rows = []
    for instance in instance_strings:
        # Remove angle brackets and split by commas.
        trimmed = instance.strip("<>")
        activities = [act.strip() for act in trimmed.split(",")]
        # Generate a unique CaseID for this instance.
        case_id = str(uuid.uuid4())
        for activity in activities:
            rows.append({"case:concept:name": case_id, "concept:name": activity})
    df = pd.DataFrame(rows)

    # Convert base_time to a pandas Timestamp if not already.
    base = pd.Timestamp(base_time)
    # Create a dummy timestamp column that increases by one time unit for each row.
    df["time:timestamp"] = [base + pd.Timedelta(i, unit=unit) for i in range(len(df))]
    return df
def RuleFit_run(X_train, y_train,X):
    # param_grid = {
    #     # Try different tree generators:
    #     'tree_generator': [
    #         RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=1),
    #     ],
    #
    # }


    # from sklearn.tree import export_text
    # tree_rules = export_text(tree_list[0], feature_names=feature_names)
    # print(tree_rules)


    # t_size = 4
    # n_rules = 100
    # tree_gen = RandomForestClassifier(n_estimators=round(n_rules/t_size), random_state=42, max_leaf_nodes=t_size,
    #                                             min_samples_leaf=round(0.1 * X_train.shape[0]),n_jobs=1)
    # # tree_gen = GradientBoostingClassifier(learning_rate=0.1, n_estimators=round(n_rules/t_size), random_state=42, max_leaf_nodes=4,
    # #                                             min_samples_leaf=round(0.1 * X_train.shape[0]))
    # # tree_gen = GradientBoostingClassifier(learning_rate=0.05, n_estimators=round(n_rules / t_size), random_state=42,
    # #                                       max_leaf_nodes=4,
    # #                                       min_samples_leaf=round(0.1 * X_train.shape[0]))
    # rf_model = RuleFit(
    #     sample_fract='default',
    #     random_state=42,
    #     rfmode='classify',
    #     model_type='r',
    #     tree_size=t_size,
    #     max_rules=np.ceil(n_rules/t_size),
    #     exp_rand_tree_size=False,
    #     cv = 5,
    # tree_generator = tree_gen
    # )




    #
    # Set up the GridSearchCV over the parameter grid.
    # from sklearn.model_selection import StratifiedKFold
    # cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    # grid_search = GridSearchCV(rf_model, param_grid=param_grid, cv=cv, scoring='accuracy'
    #                            , n_jobs=+1
    #                            )
    # Preserve the original index when resetting:
    X_train_reset = X_train.reset_index()  # This keeps the original index in a new column named "index"

    # original_ids = X_train_reset["index"].copy()  # Save the original indices for later use
    X_train_features = X_train_reset.drop(columns=["index"])  # Remove the index column before training


    # Train the RuleFit model on the reset training data.
    # rf_model.fit(X_train_features.values, y_train, feature_names=X_train_features.columns)

    # grid_search.fit(X_train_features.values, y_train, feature_names=X_train_features.columns)
    #
    # print("Best parameters:", grid_search.best_params_)
    # print("Best CV accuracy:", grid_search.best_score_)
    #
    # best_model = grid_search.best_estimator_
    # from sklearn.tree import export_text
    # tree_rules = export_text(tree_gen.fit(X_train_features.values,y_train).estimators_[
    #                              0]
    #                          , feature_names=X_train_features.columns)
    # print(tree_rules)
    #


    # best_model = rf_model.fit(X_train_features.values, y_train.values, feature_names=X_train_features.columns)


    ############# grid search #################
    from sklearn.base import BaseEstimator, ClassifierMixin
    class RuleFitWrapper(BaseEstimator, ClassifierMixin):
        def __init__(self, n_rules=100, t_size=4, model_type='r', rfmode='classify', learning_rate=0.1, tree_type='rf'):
            self.n_rules = n_rules
            self.t_size = t_size
            self.model_type = model_type
            self.rfmode = rfmode
            self.learning_rate = learning_rate
            self.tree_type = tree_type
            self.model = None


        def fit(self, X, y):
            from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
            min_samples = int(round(0.1 * X.shape[0]))

            if self.tree_type == 'rf':
                tree_generator = RandomForestClassifier(
                    n_estimators=self.n_rules // self.t_size,
                    random_state=42,
                    max_leaf_nodes=self.t_size,
                    min_samples_leaf=min_samples
                )
            elif self.tree_type == 'gb':
                tree_generator = GradientBoostingClassifier(
                    learning_rate=self.learning_rate,
                    n_estimators=self.n_rules // self.t_size,
                    random_state=42,
                    max_leaf_nodes=self.t_size,
                    min_samples_leaf=min_samples
                )
            else:
                raise ValueError("tree_type must be 'rf' or 'gb'")

            self.model = RuleFit(
                sample_fract='default',
                random_state=42,
                rfmode=self.rfmode,
                model_type=self.model_type,
                tree_size=self.t_size,
                max_rules=int(np.ceil(self.n_rules / self.t_size)),
                exp_rand_tree_size=False,
                cv=5,
                tree_generator=tree_generator
            )

            self.model.fit(X.values, y.values, feature_names=X.columns)
            return self

        def predict(self, X):
            return self.model.predict(X.values)

        def predict_proba(self, X):
            return self.model.predict_proba(X.values)

    from sklearn.model_selection import GridSearchCV

    param_grid = {
        'n_rules': [100, 200],
        't_size': [3, 4],
        'tree_type': ['rf', 'gb'],
        'learning_rate': [0.05, 0.1]  # will only be used if tree_type == 'gb'
    }

    grid_search = GridSearchCV(
        RuleFitWrapper(),
        param_grid,
        scoring='accuracy',
        cv=3,
        verbose=1,
        # n_jobs=-1
    )

    grid_search.fit(X_train_features, y_train)

    print("✅ Best Params:", grid_search.best_params_)
    print("📈 Best Accuracy:", grid_search.best_score_)

    best_model = grid_search.best_estimator_.model

    ########################

    # from sklearn.tree import export_text
    # for est in best_model.rule_ensemble.tree_list:
    #     tree_rules = export_text(est[0]
    #                              , feature_names=X_train_features.columns)
    #     print(tree_rules)


    # Extract the rules and coefficients.
    rules = best_model.get_rules()
    print(f"total number of rules is {len(rules)}")
    # rules = rules[(rules['importance']>0.05)&(rules['support']>0.05)].sort_values("support", ascending=False)
    rules = rules[(rules.coef != 0)].sort_values("importance", ascending=False)
    rules.index = rules.index.astype(str)
    rules_names = list(rules.rule.astype(str))
    print("Top extracted rules:")
    pd.set_option('display.max_colwidth', None)
    print(rules[0:5])

    ################# Rules are discoveres, We perform Filtering based on all cases
    # X_reset = X_train.reset_index()
    X_reset = X.reset_index()
    original_ids = X_reset["index"].copy()  # Save the original indices for later use
    X_wo_traces = X_reset.drop(columns=["index"])
    X_rules_all = best_model.transform(X_wo_traces.values)

    # Transform the training data to get the binary rule matrix.
    # X_rules_all = rf_model.transform(X_train_features.values)
    all_rule_names = best_model.get_rules().index.astype(str)
    X_rules_df_all = pd.DataFrame(X_rules_all, columns=all_rule_names)

    # Subset the binary rule matrix for non-zero rules.
    filtered_rule_names = rules.index.astype(str)
    X_rules_df = X_rules_df_all[filtered_rule_names]

    # -----------------------------------------------------------
    # For each filtered rule, compute the Jaccard distance between the sets of indices (rows) where the rule is active.
    filtered_rule_names_list = list(filtered_rule_names)

    return best_model, filtered_rule_names_list, X_rules_df,rules_names



def evaluate_model(model, X_test,y_test,OUTPUT_FOLDER):
    # Generate predictions on the test data.
    # X_test_rules = best_model.transform(X_test_features.values)
    X_test_reset = X_test.reset_index()
    X_test_features = X_test_reset.drop(columns=["index"])
    if variant== "RuleFit":
        y_pred = model.predict(X_test_features.values)
    elif variant== "Ripper":
        y_pred = model.predict(X_test_features)

    # Calculate evaluation metrics.
    accuracy = accuracy_score(y_test, y_pred)
    conf_matrix = confusion_matrix(y_test, y_pred)
    class_report = classification_report(y_test, y_pred)
    class_report_dict = classification_report(y_test, y_pred, output_dict=True)

    # Report the results.
    print(f"Test Accuracy: {accuracy:.4f}")
    print("Confusion Matrix:")
    print(conf_matrix)
    print("Classification Report:")
    print(class_report)

    # Save classification report as JSON
    with open(os.path.join(OUTPUT_FOLDER,"classification_report"), "w") as f:
        json.dump(class_report_dict, f, indent=4)




def run_discriminator(LP_path,LM_path,OUTPUT_FOLDER):
    path = OUTPUT_FOLDER
    Lall_path = os.path.join(path, "all.xes")
    lp_df = pm4py.read_xes(str(LP_path), variant="rustxes")
    lm_df = pm4py.read_xes(str(LM_path), variant="rustxes")
    # df_concat = pd.concat([lp_df, lm_df], ignore_index=True)
    df_concat = pd.concat([lp_df, lm_df])
    pm4py.write_xes(df_concat, Lall_path)
    # pm4py.write_xes(lp_df, path + r"\cluster_0.xes")

    # trace_variants_P, activity_list_P = extract_trace_variants(LP_path)
    # trace_variants_M, activity_list_M = extract_trace_variants(LM_path)
    variantsP = variants_filter.get_variants(lp_df)

    # activity_list_P = {act for var in variantsP for act in var}
    # Count frequencies of each variant
    trace_variants_P = {"\u003c" + ",".join(variant) + "\u003e": len(instances) for variant, instances in
                      variantsP.items()}

    variantsM = variants_filter.get_variants(lm_df)

    # Count frequencies of each variant
    trace_variants_M = {"\u003c" + ",".join(variant) + "\u003e": len(instances) for variant, instances in
                        variantsM.items()}


    conf = 0
    support = 0.0000001
    meas_P_path = os.path.join(path, f"test_P_mes_{round(conf * 100)}.json")
    meas_M_path = os.path.join(path, f"test_M_mes_{round(conf * 100)}.json")
    decl_all_path = os.path.join(path, f"test_all_{round(conf * 100)}.json")

    discover_declare_no_prune(Lall_path, decl_all_path)
    decl_all = read_json_file(decl_all_path)
    decl_model = re_write_model(decl_all, mapping, decl_all_path, support, conf)

    # Per-trace Declare verdicts. Replaces Janus (JanusMeasurementsStarter): the pure
    # Python evaluator reproduces its satisfied/violated/v_satisfied labels exactly.
    data_P = evaluate_log(trace_variants_P.keys(), decl_model)
    df_P = encode(trace_variants_P, data_P)

    data_M = evaluate_log(trace_variants_M.keys(), decl_model)
    df_M = encode(trace_variants_M, data_M)

    # Prepare the data.
    X, y = prepare_data(df_P, df_M)

    # ###### MCA ############
    # import prince
    # # Initialize and fit MCA
    # mca = prince.MCA(n_components=20, random_state=42)
    # mca = mca.fit(X)
    #
    # # Get eigenvalues
    # eigenvalues = mca.eigenvalues_
    # print("Eigenvalues:", eigenvalues)
    #
    # category_coords = mca.column_coordinates(X)
    #
    # # Plot scree plot
    # plt.plot(range(1, len(eigenvalues) + 1), eigenvalues, marker='o')
    # plt.xlabel('Component')
    # plt.ylabel('Eigenvalue')
    # plt.title('Scree Plot for MCA')
    # plt.show()



    def drop_duplicate_and_constant_columns(dataframe):
        duplicate_cols = set()
        cols = dataframe.columns
        # for i in range(len(cols)):
        #     for j in range(i + 1, len(cols)):
        #         if dataframe[cols[i]].equals(dataframe[cols[j]]):
        #             duplicate_cols.add(cols[j])

        # Identify columns where all values are 1
        constant_one_cols = {col for col in dataframe.columns if (dataframe[col] == 1).all()}

        # Combine duplicate columns and constant 1 columns
        # remove_cols = duplicate_cols.union(constant_one_cols)
        remove_cols = constant_one_cols

        # print(f"Number of duplicate columns: {len(duplicate_cols)}")
        print(f"Number of constant 1 columns: {len(constant_one_cols)}")
        print(f"Total columns to remove: {len(remove_cols)}")

        return dataframe.drop(columns=remove_cols)

    # # Example usage:
    # X = drop_duplicate_and_constant_columns(X)
    # def filter_redundant_features(df, threshold=0.95):
    #     """
    #     Remove redundant features based on pairwise correlation.
    #
    #     Parameters:
    #         df (DataFrame): Input DataFrame with features.
    #         threshold (float): Correlation threshold to consider features as redundant.
    #
    #     Returns:
    #         df_reduced (DataFrame): DataFrame with redundant features removed.
    #     """
    #     # Compute the correlation matrix (absolute values)
    #     corr_matrix = df.corr().abs()
    #
    #     # Create an upper triangle matrix of correlations
    #     upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
    #
    #     # Find features with correlation greater than the threshold
    #     to_drop = [column for column in upper.columns if any(upper[column] > threshold)]
    #
    #     print("Dropping features:", len(to_drop))
    #     # Drop these features from the DataFrame
    #     df_reduced = df.drop(columns=to_drop)
    #     return df_reduced


    # X = filter_redundant_features(X, threshold=0.95)

    # print("Original DataFrame:")
    # print(df)
    # print("\nDataFrame after removing redundant features:")
    # print(df_reduced)


    X.to_csv(os.path.join(path,"X.csv"))
    y.to_csv(os.path.join(path, "y.csv"))

    # Split into training and test sets (holdout test set)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42, stratify=y)



    undersampler = RandomUnderSampler(random_state=42)
    X_train, y_train = undersampler.fit_resample(X_train, y_train)


    #
    # oversampler = RandomOverSampler(random_state=42)
    # X_train, y_train = oversampler.fit_resample(X_train, y_train)

    t_size = 4
    n_rules = 50
    tree_gen = RandomForestClassifier(n_estimators=round(n_rules / t_size), random_state=42, max_leaf_nodes=t_size,
                                      min_samples_leaf=round(0.1 * X_train.shape[0]),class_weight='balanced_subsample')
    # tree_gen = GradientBoostingClassifier(n_estimators=round(n_rules / t_size), random_state=42, max_leaf_nodes=t_size,
    #                                   min_samples_leaf=round(0.1 * X_train.shape[0]))
    # from sklearn.svm import SVC
    # tree_gen = SVC(kernel='rbf', C=1.0, gamma='scale', random_state=42)
    # Train the classifier on the training data
    tree_gen.fit(X_train, y_train)

    # Predict on the test data
    y_pred = tree_gen.predict(X_test)

    # Calculate the accuracy
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Accuracy: {accuracy:.2f}")


    # variant = "Ripper"
    if variant == "RuleFit":
        model, filtered_rule_names_list, X_rules_df,rules_names = RuleFit_run(X_train, y_train, X)
    elif variant =="Ripper":
        model, filtered_rule_names_list, X_rules_df = Ripper(X_train, y_train, X)
        # model_M, filtered_rule_names_list_M, X_rules_df_M = Ripper(X_train, ~y_train, X)

    evaluate_model(model, X_test, y_test,OUTPUT_FOLDER)

    joblib.dump(model, os.path.join(path, "rulefit_model.pkl"))


    jaccard_df, condensed_jaccard = jaccard_calc(filtered_rule_names_list, X_rules_df)
    # jaccard_df, condensed_jaccard = normalized_hamming_calc(filtered_rule_names_list, X_rules_df)

    # columns = [str(x) for x in model.rule_ensemble.rules]
    # rows =rules_names
    print(filtered_rule_names_list)

    # Change column names using the string representation of each rule in the ensemble.
    X_rules_df.columns = rules_names

    # Change the index to the index values from X_train.
    X_rules_df.index = list(X.index)
    X_rules_df['y'] = y
    # X_rules_df.index = list(X_train.index)
    # X_rules_df['y'] = y_train
    X_rules_df.to_csv(os.path.join(path,'regression_dataframe.csv'))


    if variant == "RuleFit":
        # Structured clustermap payload — the SPA renders it natively (SVG heatmap +
        # dendrogram + importance/support strips) instead of a server-side PNG.
        rules = model.get_rules()
        rules = rules[(rules.coef != 0)].sort_values("importance", ascending=False)
        rules.index = rules.index.astype(str)

        # Compute the linkage matrix and the leaf order it induces.
        Z = linkage(condensed_jaccard, method='average')
        dendro = dendrogram(Z, no_plot=True)
        order = [int(i) for i in dendro["leaves"]]
        ordered_names = [filtered_rule_names_list[i] for i in order]
        matrix = jaccard_df.values[np.ix_(order, order)]

        viz = {
            "labels": [f"rule {n}" for n in ordered_names],
            "descriptions": [str(rules.loc[n, "rule"]) for n in ordered_names],
            "matrix": [[round(float(v), 4) for v in row] for row in matrix],
            "importance": [round(float(rules.loc[n, "coef"]), 4) for n in ordered_names],
            "support": [round(float(rules.loc[n, "support"]), 4) for n in ordered_names],
            # scipy dendrogram geometry: icoord spans the leaf axis (leaf k at 5+10k,
            # in *leaf order*), dcoord the linkage distance.
            "dendrogram": {"icoord": dendro["icoord"], "dcoord": dendro["dcoord"]},
        }
        return viz, Z
    elif variant=="Ripper":
        plt.figure(figsize=(12, 10))
        ax0 = sns.heatmap(jaccard_df, cmap="Blues", annot=False)

        # Set the custom tick labels on both axes.
        # ax0.set_xticklabels(custom_labels, rotation=90)
        # ax0.set_yticklabels(custom_labels, rotation=0)

        ax0.set_title("Jaccard Distance Heatmap with Rule Information")
        plt.title("Hierarchically Clustered Jaccard Distance\nwith Rule Importance and Support")
        plt.savefig(os.path.join(path, "my_plot.pdf"), format="pdf")
        buf = BytesIO()
        plt.savefig(buf, format="png", bbox_inches='tight')
        # Embed the result in the html output.
        fig_data = base64.b64encode(buf.getbuffer()).decode("ascii")

        if len(condensed_jaccard) !=0:
            Z = linkage(condensed_jaccard, method='average')
        else:
            Z = np.empty((0,))

        for i, r in enumerate(filtered_rule_names_list):
            original_indices = X_rules_df[X_rules_df[r] == 1].index.tolist()
            df_instances = process_event_log_instances(original_indices,
                                                       base_time="2020-01-01 00:00:00", unit="s")
            pm4py.write_xes(df_instances, os.path.join(path, f'cluster_{i+1}'))
            print(df_instances)

        return f'data:image/png;base64,{fig_data}', Z


def clustering_apply(n_clusters, Z, path, X=None, y=None, rf_model=None):
    # Phase-1 state (feature matrix, labels, fitted model) is normally passed in from
    # Postgres (session_blobs / discriminative_features) so this phase does not depend
    # on the worker's local filesystem; the CSV/pickle reads remain as a fallback.
    if X is None:
        X = pd.read_csv(os.path.join(path,"X.csv"))
    if y is None:
        y = pd.read_csv(os.path.join(path,"y.csv"))
    # X_reset = X.reset_index()
    original_ids = X["index"].copy()  # Save the original indices for later use
    X_wo_traces = X.drop(columns=["index"])
    if rf_model is None:
        rf_model = joblib.load(os.path.join(path,"rulefit_model.pkl"))

    if variant=="RuleFit":
        rules = rf_model.get_rules()
        # rules = rules[(rules['importance']>0.05)&(rules['support']>0.05)].sort_values("support", ascending=False)
        rules = rules[(rules.coef != 0)].sort_values("importance", ascending=False)
        rules.index = rules.index.astype(str)

        filtered_rule_names_list = list(rules.index.astype(str))
        all_rule_names = rf_model.get_rules().index.astype(str)

        X_rules_all = rf_model.transform(X_wo_traces.values)
        X_rules_df_all = pd.DataFrame(X_rules_all, columns=all_rule_names)

        # Subset the binary rule matrix for non-zero rules.
        filtered_rule_names = rules.index.astype(str)
        X_rules_df = X_rules_df_all[filtered_rule_names]
        max_clusters = n_clusters
        clusters = fcluster(Z, t=max_clusters, criterion='maxclust')
        # clusters = fcluster(Z, t=0.01, criterion='distance')
        # if len(Z)!=0:
        #     clusters = fcluster(Z, t=max_clusters, criterion='maxclust')
        # else:
        #     clusters = filtered_rule_names_list
        # clusters = np.array([i for i in range(1, n_clusters + 1)])

        cluster_df = pd.DataFrame({
            'rule': filtered_rule_names_list,
            'cluster': clusters
        })
        print("Cluster assignments:")
        print(cluster_df)

        results = {}
        for cl in np.unique(clusters):
            cluster_rules = cluster_df[cluster_df['cluster'] == cl]['rule']
            cluster_rules_df = rules.loc[cluster_rules]
            rules_stats = {}
            for rule in cluster_rules_df.iterrows():
                rule_str = rule[1].name  # Extract rule expression
                stats = compute_stats(rule_str, X_rules_df, y)
                stats['description'] = rule[1]['rule'],
                stats['number'] = rule[1].name,
                stats['support_training'] = round(rule[1]['support'], 2)
                stats['coef'] = round(rule[1]['coef'], 2)
                stats['importance'] = round(rule[1]['importance'], 2)
                rules_stats[rule_str] = stats
            # print(rules_stats)
            rule_max_support = cluster_rules_df.loc[cluster_rules_df['support'].idxmax()]
            rule_max_importance = cluster_rules_df.loc[cluster_rules_df['importance'].idxmax()]
            rule_max_importance_id = rule_max_importance.name

            # Extract original indices from X_rules_df (using our preserved 'index' column) where the rule applies.
            # satisfied_instances = X_rules_df[X_rules_df[rule_max_importance_id] == 1].index.tolist()
            # If you want the original indices from X_train, use the corresponding 'index' column:

            # if rule_max_importance['coef']>=0:
            #     original_indices = X.loc[
            #         X_rules_df[X_rules_df[rule_max_importance_id] == 1].index, 'index'].tolist()
            # else:
            #     original_indices = X.loc[
            #         X_rules_df[X_rules_df[rule_max_importance_id] == 0].index, 'index'].tolist()

            original_indices = X.loc[
                X_rules_df[X_rules_df[rule_max_importance_id] == 1].index, 'index'].tolist()

            results[str(cl)] = {
                'max_support_rule': rule_max_support,
                'max_importance_rule': rule_max_importance,
                'satisfied_original_indices': original_indices,  # Original indices from X_train.
                'all_rules_in_cluster': cluster_rules_df,
                'stats': rules_stats
            }

        for cl, vals in results.items():
            print(f"\nCluster {cl}:")
            print("Rule with maximum support:")
            print(vals['max_support_rule'][['rule', 'support']])
            print("Rule with maximum absolute importance:")
            print(vals['max_importance_rule'][['rule', 'coef']])
            # print("Original indices of instances satisfying the max importance rule:")
            # print(vals['satisfied_original_indices'])



    elif variant =="Ripper":
        filtered_rule_names, X_rules_df = extract_rules_ripper(X, rf_model)
        results = {}
        for i,rule in enumerate(filtered_rule_names):
            # cluster_rules = cluster_df[cluster_df['cluster'] == cl]['rule']
            # cluster_rules_df = rules.loc[cluster_rules]
            # rules_stats = {}
            # for rule in cluster_rules_df.iterrows():

            stats = compute_stats_ripper(rule, X_rules_df, y)
            stats['description'] = rule,
            # stats['number'] = rule[1].name,
            # stats['support_training'] = round(rule[1]['support'], 2)
            # stats['coef'] = round(rule[1]['coef'], 2)
            # stats['importance'] = round(rule[1]['importance'], 2)
            # rules_stats[rule_str] = stats
            # # print(rules_stats)
            # rule_max_support = cluster_rules_df.loc[cluster_rules_df['support'].idxmax()]
            # rule_max_importance = cluster_rules_df.loc[cluster_rules_df['importance'].idxmax()]
            # rule_max_importance_id = rule_max_importance.name

            # Extract original indices from X_rules_df (using our preserved 'index' column) where the rule applies.
            # satisfied_instances = X_rules_df[X_rules_df[rule_max_importance_id] == 1].index.tolist()
            # If you want the original indices from X_train, use the corresponding 'index' column:

            # if rule_max_importance['coef']>=0:
            #     original_indices = X.loc[
            #         X_rules_df[X_rules_df[rule_max_importance_id] == 1].index, 'index'].tolist()
            # else:
            #     original_indices = X.loc[
            #         X_rules_df[X_rules_df[rule_max_importance_id] == 0].index, 'index'].tolist()

            original_indices = X.loc[
                X_rules_df[X_rules_df[rule] == 1].index, 'index'].tolist()

            results[str(i+1)] = {
                # 'max_support_rule': rule_max_support,
                # 'max_importance_rule': rule_max_importance,
                'satisfied_original_indices': original_indices,  # Original indices from X_train.
                # 'all_rules_in_cluster': cluster_rules_df,
                'stats': stats
            }

    for cl in results.keys():
        df_instances = process_event_log_instances(results[cl]['satisfied_original_indices'],
                                                   base_time="2020-01-01 00:00:00", unit="s")
        pm4py.write_xes(df_instances, os.path.join(path, f'cluster_{cl}'))
        print(df_instances)






    # plt.show()

    return results



